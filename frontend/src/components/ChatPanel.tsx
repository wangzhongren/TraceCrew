import { useState, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { marked } from 'marked';
import type { PipelineState } from '../App';
import PlanCard from './PlanCard';
import ReviewCard from './ReviewCard';
import type { CallGraph } from './MapCanvas';
import { useT, useLocale } from '../i18n';

/* ── Types ── */

type TimelineEntry =
  | { kind: 'agent'; agent: string; text: string; reasoning?: string; result?: any; autoCollapse?: boolean }
  | { kind: 'tool'; agent: string; tool: string; file: string }
  | { kind: 'user'; text: string }
  | { kind: 'system'; text: string };

/* ── Agent config ── */

const AG: Record<string, { name: string; color: string }> = {
  planner:  { name: 'Planner',  color: '#2563eb' },
  mapper:   { name: 'Mapper',   color: '#7c3aed' },
  reviewer: { name: 'Reviewer', color: '#dc2626' },
};

const TOOL_LABEL: Record<string, string> = {
  read_file: 'Read', list_dir: 'List', search: 'Search',
  insert_lines: 'Insert', replace_lines: 'Replace', delete_lines: 'Delete',
  create_file: 'Create', run_shell: 'Run',
};

const TOOL_COLOR: Record<string, { bg: string; c: string }> = {
  read_file:    { bg: '#dbeafe', c: '#2563eb' },
  list_dir:     { bg: '#dbeafe', c: '#2563eb' },
  search:       { bg: '#dbeafe', c: '#2563eb' },
  insert_lines: { bg: '#dcfce7', c: '#16a34a' },
  replace_lines:{ bg: '#dcfce7', c: '#16a34a' },
  create_file:  { bg: '#dcfce7', c: '#16a34a' },
  delete_lines: { bg: '#fee2e2', c: '#dc2626' },
  run_shell:    { bg: '#fef3c7', c: '#b45309' },
};

/* ══════════════════════════════════════════════ */

export default function ChatPanel({ projectPath, onPipelineChange, savedPlan, savedGraph }: {
  projectPath: string | null;
  onPipelineChange: (s: Partial<PipelineState>) => void;
  savedPlan?: { plan_summary: string; raw?: string; steps?: any[]; key_files?: string[] } | null;
  savedGraph?: { nodes: any[]; edges: any[] } | null;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const restoredRef = useRef(false);

  // Inject restored plan + graph as initial chat message AND agent history
  useEffect(() => {
    if (restoredRef.current) return;
    if (savedPlan || savedGraph) {
      restoredRef.current = true;
      const parts: string[] = [];
      if (savedPlan?.plan_summary) {
        parts.push(`## 📋 上次计划\n${savedPlan.plan_summary}`);
      }
      if (savedPlan?.steps?.length) {
        parts.push(`### 步骤\n${savedPlan.steps.map((s: any, i: number) => `${i + 1}. ${s.description || s.title || ''}`).join('\n')}`);
      }
      if (savedGraph?.nodes?.length) {
        const done = savedGraph.nodes.filter((n: any) => n.status === 'done' || n.status === 'existing').length;
        const total = savedGraph.nodes.filter((n: any) => n.status !== 'existing').length;
        parts.push(`### 任务进度\n已完成 ${done}/${total} 个任务`);
        const pending = savedGraph.nodes.filter((n: any) => n.status !== 'done' && n.status !== 'existing');
        if (pending.length > 0) {
          parts.push(`**待完成**: ${pending.map((n: any) => n.label).join('、')}`);
        }
      }
      const summary = parts.join('\n\n');
      setTimeline([{ kind: 'agent', agent: 'planner', text: summary, result: { type: 'plan', plan: savedPlan || {} }, autoCollapse: true }]);

      // Inject into agent history — preserve full context for subsequent conversations
      const requirement = savedPlan?.raw?.match(/## 需求\n([\s\S]*?)\n## /)?.[1]?.trim()
        || savedPlan?.plan_summary
        || '';
      const historyCtx: string[] = [
        savedPlan?.plan_summary ? `[计划] ${savedPlan.plan_summary}` : '',
        savedPlan?.steps?.length ? `[步骤]\n${savedPlan.steps.map((s: any, i: number) => `${i + 1}. ${s.description || s.title || JSON.stringify(s)}`).join('\n')}` : '',
        savedPlan?.key_files?.length ? `[关键文件] ${savedPlan.key_files.join(', ')}` : '',
        savedGraph?.nodes?.length ? `[任务节点]\n${savedGraph.nodes.map((n: any) => `- ${n.status === 'done' || n.status === 'existing' ? '✅' : '⬜'} ${n.label} [${n.kind}]${n.file ? ` @${n.file}${n.line ? `:L${n.line}` : ''}` : ''}${n.detail ? ` — ${n.detail}` : ''}`).join('\n')}` : '',
        savedGraph?.edges?.length ? `[依赖关系] ${savedGraph.edges.map((e: any) => `${e.from}→${e.to}[${e.status}]`).join(', ')}` : '',
      ];
      historyRef.current = [
        { role: 'user', content: requirement },
        { role: 'assistant', content: historyCtx.filter(Boolean).join('\n\n') },
      ];
    }
  }, [savedPlan, savedGraph]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const historyRef = useRef<Array<{ role: string; content: string }>>([]);
  const plannerUsedTools = useRef(false);
  const tidxRef = useRef(-1);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [timeline]);

  /* ── Helpers ── */

  const parseJson = (text: string): any => {
    if (!text) return null;
    const m = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (m) { try { return JSON.parse(m[1]); } catch {} }
    for (const key of ['"call_graph"', '"plan_summary"', '"passed"']) {
      const idx = text.indexOf(key);
      if (idx !== -1) {
        const start = text.lastIndexOf('{', idx);
        if (start !== -1) {
          let depth = 0, end = -1;
          for (let i = start; i < text.length; i++) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
          }
          if (end !== -1) { try { return JSON.parse(text.slice(start, end)); } catch {} }
        }
      }
    }
    const greedy = text.match(/\{[\s\S]*\}/);
    if (greedy) { try { return JSON.parse(greedy[0]); } catch {} }
    return null;
  };

  /* ── SSE stream ── */

  const streamSSE = async (body: Record<string, any>, onToken: (t: string) => void, onReasoning?: (t: string) => void, onTools?: (ops: any[]) => void) => {
    const res = await fetch('/api/v1/agent/chat/stream', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, project_path: projectPath, locale }),
      signal: abortRef.current?.signal,
    });
    const reader = res.body?.getReader();
    if (!reader) return '';
    const dec = new TextDecoder();
    let buf = '', full = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n');
      buf = parts.pop() || '';
      for (const line of parts) {
        if (!line.trim()) continue;
        const { event, data } = JSON.parse(line);
        if (event === 'token') { full += data; onToken(data); }
        else if (event === 'reasoning') { onReasoning?.(data); }
        else if (event === 'tools') {
          const ops = typeof data === 'string' ? JSON.parse(data).ops : data.ops;
          onTools?.(ops || []);
        }
      }
    }
    return full;
  };

  /* ── Agent loop ── */

  const agentLoop = async (agent: string, systemPrompt: string, ctx: string, history?: Array<{ role: string; content: string }>) => {
    const messages = [...(history || [])];
    let fileTree: any = null;
    try { fileTree = await window.tracecrew.file.listDirectory(projectPath!); } catch {}
    messages.push({ role: 'user', content: fileTree ? `${ctx}\n\n${systemPrompt}\n\n【项目文件树】\n${JSON.stringify(fileTree, null, 2).slice(0, 2000)}` : `${ctx}\n\n${systemPrompt}` });

    let fullText = '';
    setTimeline(prev => { tidxRef.current = prev.length; return [...prev, { kind: 'agent', agent, text: '', reasoning: '', result: null }]; });

    await streamSSE({ history: messages, mode: agent },
      (t) => {
        fullText += t;
        setTimeline(prev => {
          const u = [...prev];
          const idx = tidxRef.current;
          if (idx < 0) return u;
          const entry = u[idx];
          if (entry?.kind === 'agent') u[idx] = { ...entry, text: entry.text + t };
          return u;
        });
      },
      (t) => {
        setTimeline(prev => {
          const u = [...prev];
          const idx = tidxRef.current;
          if (idx < 0) return u;
          const entry = u[idx];
          if (entry?.kind === 'agent') u[idx] = { ...entry, reasoning: (entry.reasoning || '') + t };
          return u;
        });
      },
      (ops) => {
        if (agent === 'planner') plannerUsedTools.current = true;
        for (const op of ops) {
          setTimeline(prev => [...prev, { kind: 'tool', agent, tool: op.type, file: op.file || '' }]);
        }
      }
    );
    return { fullText };
  };

  /* ════ Pipeline ════ */

  const runPlanner = async (instruction: string) => {
    if (!projectPath) return;
    setRunning(true);
    plannerUsedTools.current = false;
    abortRef.current = new AbortController();
    const hist = [...historyRef.current, { role: 'user', content: instruction }];

    onPipelineChange({ phase: 'planning' });
    const { fullText } = await agentLoop('planner', '', '', hist);
    const plan = parseJson(fullText);
    hist.push({ role: 'assistant', content: `[Plan] ${plan?.plan_summary || fullText}` });
    historyRef.current = hist;

    // Attach plan result to the agent block
    setTimeline(prev => {
      const u = [...prev];
      for (let i = u.length - 1; i >= 0; i--) {
        const e: any = u[i];
        if (e.kind === 'agent' && e.agent === 'planner') {
          u[i] = { ...e, result: { type: 'plan', plan: plan || { plan_summary: fullText.slice(0, 300) } } };
          return u;
        }
      }
      return u;
    });

    if (!plannerUsedTools.current && (fullText || '').length <= 100) {
      setTimeline(prev => [...prev, { kind: 'system', text: t('chat.plannerNoFiles') }]);
      onPipelineChange({ phase: 'done' });
      setRunning(false);
      return;
    }

    await runReviewPlan(instruction, fullText, plan);
  };

  const runReviewPlan = async (instruction: string, plannerText: string, plan: any) => {
    onPipelineChange({ phase: 'reviewing' });
    const { fullText } = await agentLoop('reviewer', '',
      `【需求】${instruction}\n【Planner输出】${plannerText}\n【关键文件】${(plan?.key_files || []).join(', ') || '无'}\n\n请验证 Planner 的分析是否基于实际代码，结论是否有证据支撑。`,
      [...historyRef.current]
    );

    const review = parseJson(fullText) || (() => {
      if (/"passed"\s*:\s*false/i.test(fullText)) return { passed: false, feedback: fullText, issues: [] };
      if (/"passed"\s*:\s*true/i.test(fullText)) return { passed: true, feedback: fullText, issues: [] };
      return { passed: /PASSED/i.test(fullText) && !/FAILED/i.test(fullText), feedback: fullText, issues: [] };
    })();

    // Attach review result
    setTimeline(prev => {
      const u = [...prev];
      for (let i = u.length - 1; i >= 0; i--) {
        const e: any = u[i];
        if (e.kind === 'agent' && e.agent === 'reviewer') {
          u[i] = { ...e, result: { type: 'review', passed: review.passed, feedback: review.feedback, issues: review.issues || [] } };
          return u;
        }
      }
      return u;
    });

    historyRef.current.push({ role: 'assistant', content: `[Reviewer] ${fullText}` });

    if (review.passed) {
      const saved = { plan_summary: plan?.plan_summary || '', steps: plan?.steps || [], key_files: plan?.key_files || [], raw: plannerText };
      onPipelineChange({ savedPlan: saved });

      if (projectPath) {
        const stepsMd = (saved.steps || []).map((s: any, i: number) => `${i + 1}. ${s.description || s.desc || JSON.stringify(s)}`).join('\n');
        // Save plan to .tracecrew/plans/ with versioning
        try {
          const date = new Date().toISOString().slice(0, 10);
          // Let AI generate a short filename
          let slug = 'plan';
          try {
            const res = await fetch('/api/v1/agent/name-plan', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ summary: saved.plan_summary }),
            });
            const data = await res.json();
            slug = data.name || slug;
          } catch { /* fallback to 'plan' */ }
          const planFile = `.tracecrew/plans/${date}-${slug}.md`;
          const planMd = [
            `# Planner Report — ${date}`,
            '',
            `## 需求`,
            instruction,
            '',
            `## 计划摘要`,
            saved.plan_summary,
            '',
            `## 步骤`,
            stepsMd || '(无)',
            '',
            `## 关键文件`,
            saved.key_files.join(', ') || '(无)',
            '',
            `## 原始分析`,
            plannerText,
          ].join('\n');
          await window.tracecrew.file.writeFile(planFile, planMd);
          // Update latest symlink
          await window.tracecrew.file.writeFile('.tracecrew/plans/latest.md', planMd);
          // Update README index
          const entry = `| ${date} | [${saved.plan_summary.slice(0, 60)}](${planFile}) | ${saved.steps?.length || 0} 步骤 |`;
          const readmeHeader = `# Plans\n\n| 日期 | 计划 | 步骤 |\n|------|------|------|`;
          let existing = '';
          try { const fc = await window.tracecrew.file.readFile('.tracecrew/plans/README.md'); if (fc?.content) existing = fc.content; } catch {}
          if (!existing) {
            await window.tracecrew.file.writeFile('.tracecrew/plans/README.md', `${readmeHeader}\n${entry}\n`);
          } else if (!existing.includes(planFile)) {
            const idx = existing.indexOf('\n', existing.indexOf('|---'));
            const before = existing.slice(0, idx + 1);
            const after = existing.slice(idx + 1);
            await window.tracecrew.file.writeFile('.tracecrew/plans/README.md', `${before}\n${entry}${after}`);
          }
        } catch {}
      }

      await runMapper(instruction, plan, plannerText);
    } else {
      setTimeline(prev => [...prev, { kind: 'system', text: t('chat.reviewFailed') }]);
      onPipelineChange({ phase: 'rejected' });
      setRunning(false);
      setTimeout(() => runPlanner(instruction), 500);
    }
  };

  const runMapper = async (instruction: string, plan: any, plannerText?: string) => {
    const planCtx = plan?.plan_summary
      ? `【计划】${plan.plan_summary}\n【关键文件】${(plan.key_files || []).join(', ')}\n【备注】${plan.notes || ''}`
      : `【Planner 分析】(未输出JSON,以下为原始分析)\n${(plannerText || '').slice(-2000)}`;
    const { fullText } = await agentLoop('mapper', '', `【需求】${instruction}\n${planCtx}`, [...historyRef.current]);

    let data = parseJson(fullText);

    // Attach mapper result
    let graph: CallGraph | null = null;
    if (data?.call_graph?.nodes?.length > 0) {
      const EDGE_STATUS_MAP: Record<string, 'existing' | 'new' | 'removed' | 'error'> = {
        existing: 'existing', new: 'new', removed: 'removed', error: 'error',
        planned_new: 'new', planned_change: 'existing',
      };
      const edges = (data.call_graph.edges || []).map((e: any) => ({ ...e, status: EDGE_STATUS_MAP[e.status] || 'new' }));
      graph = { nodes: data.call_graph.nodes, edges };
    }

    setTimeline(prev => {
      const u = [...prev];
      for (let i = u.length - 1; i >= 0; i--) {
        const e: any = u[i];
        if (e.kind === 'agent' && e.agent === 'mapper') {
          u[i] = { ...e, result: { type: 'graph', nodes: graph?.nodes.length || 0, edges: graph?.edges.length || 0 }, autoCollapse: true };
        }
        // Collapse reviewer when mapper completes
        if (e.kind === 'agent' && e.agent === 'reviewer') {
          u[i] = { ...e, autoCollapse: true };
        }
      }
      return u;
    });

    historyRef.current.push({ role: 'assistant', content: `[Mapper] ${graph ? `${graph.nodes?.length || 0} 个节点, ${graph.edges?.length || 0} 条边` : `未生成调用图: ${fullText.slice(0, 200)}`}` });

    if (graph) {
      if (!data?.call_graph) data = parseJson(fullText); // retry
      flushSync(() => onPipelineChange({ phase: 'done', graph }));
    } else {
      setTimeline(prev => [...prev, { kind: 'system', text: t('chat.mapperNoGraph') }]);
      onPipelineChange({ phase: 'done' });
    }

    setRunning(false);
  };

  const handleSend = () => {
    if (!input.trim() || running) return;
    const msg = input.trim();
    setInput('');
    setTimeline(prev => [...prev, { kind: 'user', text: msg }]);
    runPlanner(msg);
  };

function PinnedPlanCard({ plan }: { plan: { plan_summary: string; raw?: string; steps?: any[]; key_files?: string[] } }) {
  const raw = plan.raw || plan.plan_summary || '';
  const [showHistory, setShowHistory] = useState(false);
  const [planFiles, setPlanFiles] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const entries = await window.tracecrew?.file.listDirectory('.tracecrew/plans/');
        const files = (entries || [])
          .filter((e: any) => e.type === 'file' && e.name.endsWith('.md') && e.name !== 'README.md' && e.name !== 'latest.md')
          .map((e: any) => e.name)
          .sort()
          .reverse();
        setPlanFiles(files);
      } catch {}
    })();
  }, [plan]);

  const openPopup = (content: string) => {
    const cleaned = content
      .replace(/<(list-dir|read-file|run-shell|update|create-file|delete-file|search)\b[^>]*>[\s\S]*?<\/\1>/gi, '\n')
      .replace(/<(list-dir|read-file|run-shell|update|create-file|delete-file|search)\b[^>]*\/>/gi, '\n')
      .replace(/<done>[^<]*<\/done>/gi, '\n')
      .replace(/<final\/>/gi, '\n')
      .replace(/([^\n])(#{1,4}\s)/g, '$1\n$2');
    const html = marked.parse(cleaned, { async: false }) as string;
    window.tracecrew?.window.openPlan(html);
  };

  return (
    <div className="shrink-0 border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
      <div className="flex items-center gap-1.5 px-4 py-1.5">
        <span className="text-[9px] font-semibold uppercase tracking-wider shrink-0" style={{ color: '#2563eb' }}>📋 Plan</span>
        <span className="text-[10px] truncate" style={{ color: 'var(--color-text-secondary)' }}>
          {plan.plan_summary.slice(0, 60)}{plan.plan_summary.length > 60 ? '…' : ''}
        </span>
        <button onClick={() => openPopup(raw)}
          className="shrink-0 text-[9px] px-1.5 py-0.5 rounded transition-colors hover:bg-black/[0.04]"
          style={{ color: '#2563eb' }} title="展开当前计划">
          ↗
        </button>
        {/* History dropdown */}
        <div className="relative">
          <button onClick={() => setShowHistory(!showHistory)}
            className="shrink-0 text-[9px] px-1.5 py-0.5 rounded transition-colors hover:bg-black/[0.04]"
            style={{ color: 'var(--color-text-muted)' }} title="历史计划">
            📂 {planFiles.length || ''}
          </button>
          {showHistory && (
            <div className="absolute right-0 top-full mt-1 z-50 rounded-lg border shadow-lg overflow-hidden"
              style={{ width: 320, background: 'var(--color-bg-layer)', borderColor: 'var(--color-border-default)' }}
              onMouseLeave={() => setShowHistory(false)}>
              <div className="px-3 py-2 border-b text-[9px] font-semibold" style={{ borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-muted)' }}>
                历史计划 ({planFiles.length})
              </div>
              <div className="max-h-48 overflow-y-auto">
                {planFiles.length === 0 ? (
                  <div className="px-3 py-4 text-center text-[9px]" style={{ color: 'var(--color-text-muted)' }}>暂无历史</div>
                ) : (
                  planFiles.map(f => {
                    // Parse date and name from filename: 2026-06-25-name.md
                    const datePart = f.slice(0, 10);
                    const namePart = f.slice(11).replace('.md', '').replace(/-/g, ' ');
                    return (
                      <button key={f} onClick={async () => {
                        setShowHistory(false);
                        try {
                          const fc = await window.tracecrew?.file.readFile(`.tracecrew/plans/${f}`);
                          if (fc?.content) openPopup(fc.content);
                        } catch {}
                      }}
                        className="w-full text-left px-3 py-2 hover:bg-black/[0.03] transition-colors border-b last:border-b-0"
                        style={{ borderColor: 'var(--color-border-subtle)' }}>
                        <div className="text-[9px] font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>{namePart}</div>
                        <div className="text-[8px]" style={{ color: 'var(--color-text-muted)' }}>{datePart}</div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

  /* ════ Render ════ */

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--color-bg-primary)' }}>
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b flex items-center gap-2.5"
        style={{ borderColor: 'var(--color-border-subtle)', background: 'var(--color-bg-layer)' }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: '#2563eb12' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2">
            <circle cx="12" cy="12" r="3"/><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
            <circle cx="5" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>
            <line x1="12" y1="8" x2="12" y2="9"/><line x1="12" y1="15" x2="12" y2="16"/>
            <line x1="8" y1="12" x2="9" y2="12"/><line x1="15" y1="12" x2="16" y2="12"/>
          </svg>
        </div>
        <div>
          <div className="text-[11px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('chat.pipeline')}</div>
          <div className="text-[9px]" style={{ color: 'var(--color-text-muted)' }}>{t('chat.pipelineFlow')}</div>
        </div>
      </div>

      {/* Pinned PlanCard */}
      {savedPlan?.plan_summary && <PinnedPlanCard plan={savedPlan} />}

      {/* Timeline */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {timeline.length === 0 ? (
          <div className="flex items-center justify-center h-full px-6">
            <div className="text-center">
              <div className="w-14 h-14 mx-auto mb-3 rounded-2xl flex items-center justify-center"
                style={{ background: 'var(--color-bg-layer)', border: '2px dashed var(--color-border-subtle)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" style={{ opacity: 0.3, color: 'var(--color-text-muted)' }}>
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                  <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
              </div>
              <div className="text-[11px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('chat.describeTask')}</div>
              <div className="mt-1 text-[9px]" style={{ color: 'var(--color-text-muted)' }}>{t('chat.pipelineHint')}</div>
            </div>
          </div>
        ) : (
          <TimelineView timeline={timeline} t={t} />
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 px-3 py-2.5 border-t" style={{ borderColor: 'var(--color-border-subtle)', background: 'var(--color-bg-layer)' }}>
        <div className="flex items-end gap-2 px-3 py-2 rounded-xl border transition-colors"
          style={{ background: 'var(--color-bg-primary)', borderColor: 'var(--color-border-default)' }}>
          <textarea value={input} onChange={e => setInput(e.target.value)}
            placeholder={t('chat.inputPlaceholder')} disabled={running} rows={1}
            className="flex-1 text-[12px] bg-transparent outline-none focus:outline-none focus:ring-0 focus:ring-offset-0 resize-none min-h-[24px] max-h-[120px] leading-relaxed"
            style={{ color: 'var(--color-text-primary)' }}
            onInput={e => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = Math.min(e.currentTarget.scrollHeight, 120) + 'px'; }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); handleSend(); } }}
          />
          {running ? (
            <button onClick={() => { abortRef.current?.abort(); setRunning(false); }}
              className="shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-semibold"
              style={{ color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca' }}>
              ⏹ {t('chat.stop')}
            </button>
          ) : (
            <button onClick={handleSend} disabled={!input.trim()}
              className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg transition-all duration-150 hover:scale-105 disabled:opacity-20"
              style={{ background: input.trim() ? '#2563eb' : 'var(--color-border-subtle)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
              </svg>
            </button>
          )}
        </div>
        <div className="flex justify-between mt-1.5 px-1">
          <span className="text-[9px]" style={{ color: 'var(--color-text-muted)' }}>{t('chat.enterHint')}</span>
          <span className="text-[9px]" style={{ color: 'var(--color-text-muted)' }}>{t('chat.charCount', { count: input.length })}</span>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   Timeline renderer — pure, no side effects
   ══════════════════════════════════════════════ */

function TimelineView({ timeline, t }: { timeline: TimelineEntry[]; t: any }) {
  return (
    <div className="px-4 py-2 space-y-0.5">
      {timeline.map((entry, i) => {
        if (entry.kind === 'system') return <SystemMsg key={i} text={entry.text} />;
        if (entry.kind === 'user') return <UserMsg key={i} text={entry.text} />;
        if (entry.kind === 'tool') {
          const next = timeline[i + 1];
          const isLast = !next || next.kind !== 'tool';
          return <ToolRow key={i} entry={entry} isLast={isLast} />;
        }
        if (entry.kind === 'agent') return <AgentCard key={i} entry={entry} t={t} />;
        return null;
      })}
    </div>
  );
}

function SystemMsg({ text }: { text: string }) {
  return (
    <div className="py-1.5 text-center">
      <span className="text-[9px] px-2.5 py-0.5 rounded-full" style={{ color: 'var(--color-text-muted)', background: 'var(--color-bg-layer)' }}>
        {text}
      </span>
    </div>
  );
}

function UserMsg({ text }: { text: string }) {
  return (
    <div className="flex justify-end py-1">
      <div className="max-w-[90%] rounded-2xl rounded-tr-md px-3.5 py-2.5"
        style={{ background: 'var(--color-bg-layer)', border: '1px solid var(--color-border-subtle)' }}>
        <div className="text-[11px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-text-primary)' }}>
          {text}
        </div>
      </div>
    </div>
  );
}

function ToolRow({ entry, isLast }: { entry: TimelineEntry & { kind: 'tool' }; isLast?: boolean }) {
  const tc = TOOL_COLOR[entry.tool] || { bg: '#f3f4f6', c: '#6b7280' };
  return (
    <div className="flex items-center gap-2 py-0.5 pl-1" style={{ marginBottom: isLast ? 8 : 0 }}>
      <span className="text-[9px] font-mono font-medium rounded px-1.5 py-0.5 shrink-0"
        style={{ background: tc.bg, color: tc.c }}>
        {TOOL_LABEL[entry.tool] || entry.tool}
      </span>
      <span className="text-[9px] truncate" style={{ color: 'var(--color-text-muted)' }}>{entry.file}</span>
    </div>
  );
}

function CollapsibleReasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-2">
      <div onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[9px] cursor-pointer select-none py-0.5"
        style={{ color: 'var(--color-text-muted)' }}>
        <span>{open ? '▾' : '▸'}</span> 💭 思考过程
      </div>
      {open && (
        <div className="opacity-60" onClick={() => setOpen(false)}>
          <Markdown text={text} />
        </div>
      )}
    </div>
  );
}

/* ── Agent card ── */

function AgentCard({ entry, t }: { entry: TimelineEntry & { kind: 'agent' }; t: any }) {
  const cfg = AG[entry.agent] || { name: entry.agent, color: '#6b7280' };
  const [expanded, setExpanded] = useState(true);
  const result = entry.result;

  // Hide completely after Mapper completes
  if (entry.autoCollapse) return null;
  const hasText = !!(entry.text || '').trim();
  const isThinking = !result && hasText;

  // Status from result
  let status: 'thinking' | 'done' | 'failed' = isThinking ? 'thinking' : 'done';
  let statusLabel = '';
  if (result?.type === 'review') {
    status = result.passed ? 'done' : 'failed';
    statusLabel = result.passed ? t('chat.done') : t('chat.failed');
  } else if (result?.type === 'plan') {
    statusLabel = t('chat.done');
  } else if (result?.type === 'graph') {
    statusLabel = `${result.nodes}${t('graph.nodes')} · ${result.edges}${t('graph.edges')}`;
  } else if (isThinking) {
    statusLabel = `${Math.round(entry.text.length / 100)}${t('chat.chars')}`;
  }

  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: cfg.color + '06', border: `1px solid ${cfg.color}18` }}>
      {/* Header */}
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-black/[0.015]">
        {/* Dot */}
        <span className="shrink-0 w-[15px] h-[15px] rounded-full flex items-center justify-center"
          style={{ border: `2px solid ${status === 'failed' ? '#dc2626' : cfg.color}`, background: 'var(--color-bg-primary)' }}>
          {status === 'thinking' ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={cfg.color} strokeWidth="3" className="animate-spin">
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
            </svg>
          ) : (
            <span className="w-[6px] h-[6px] rounded-full" style={{ background: status === 'failed' ? '#dc2626' : cfg.color }} />
          )}
        </span>
        {/* Name */}
        <span className="text-[11px] font-semibold" style={{ color: cfg.color }}>{cfg.name}</span>
        {/* Status badge */}
        {statusLabel && (
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{
            background: status === 'failed' ? '#fef2f2' : status === 'done' ? '#f0fdf4' : cfg.color + '12',
            color: status === 'failed' ? '#dc2626' : status === 'done' ? '#16a34a' : 'var(--color-text-muted)',
          }}>
            {status === 'failed' ? '✕ ' : status === 'done' ? '✓ ' : ''}{statusLabel}
          </span>
        )}
        <div className="flex-1" />
        <svg width="10" height="10" viewBox="0 0 8 8"
          style={{ transform: expanded ? 'rotate(180deg)' : '', transition: 'transform 0.15s' }}>
          <path d="M2 3 L4 5 L6 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ color: cfg.color }} />
        </svg>
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-3.5 pb-3">
          {/* Reasoning — above main text, collapsible */}
          {entry.reasoning && (
            <CollapsibleReasoning text={entry.reasoning} />
          )}

          {/* Text content */}
          {(entry.text || '').trim() && <Markdown text={entry.text} />}

          {/* Plan result */}
          {result?.type === 'plan' && (
            <div className={hasText ? 'mt-2 pt-2 border-t' : ''} style={{ borderColor: 'var(--color-border-subtle)' }}>
              <PlanCard planSummary={result.plan?.plan_summary || ''} color={cfg.color} />
            </div>
          )}

          {/* Graph result */}
          {result?.type === 'graph' && (
            <div className={hasText ? 'mt-2 pt-2 border-t' : ''} style={{ borderColor: 'var(--color-border-subtle)' }}>
              <div className="flex items-center gap-2 text-[10px]" style={{ color: cfg.color }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.6">
                  <rect x="0.5" y="0.5" width="5" height="5" rx="1"/><rect x="10.5" y="0.5" width="5" height="5" rx="1"/>
                  <rect x="0.5" y="10.5" width="5" height="5" rx="1"/><rect x="10.5" y="10.5" width="5" height="5" rx="1"/>
                  <line x1="5.5" y1="3" x2="10.5" y2="3"/><line x1="3" y1="5.5" x2="3" y2="10.5"/>
                </svg>
                <span className="font-medium">{t('chat.callGraph')}</span>
                <span style={{ color: 'var(--color-text-muted)' }}>{statusLabel}</span>
              </div>
            </div>
          )}

          {/* Review result */}
          {result?.type === 'review' && (
            <div className={hasText ? 'mt-2 pt-2 border-t' : ''} style={{ borderColor: 'var(--color-border-subtle)' }}>
              <ReviewCard passed={result.passed} feedback={result.feedback} issues={result.issues} color={cfg.color} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Markdown component ── */

function Markdown({ text }: { text: string }) {
  const cleaned = text
    .replace(/<(list-dir|read-file|run-shell|update|create-file|delete-file|search)\b[^>]*>[\s\S]*?<\/\1>/gi, '\n')
    .replace(/<(list-dir|read-file|run-shell|update|create-file|delete-file|search)\b[^>]*\/>/gi, '\n')
    .replace(/<done>[^<]*<\/done>/gi, '\n')
    .replace(/<step-done[^>]*>[^<]*<\/step-done>/gi, '\n')
    .replace(/<all-done>[^<]*<\/all-done>/gi, '\n')
    .replace(/<final\/>/gi, '\n')
    .replace(/([^\n])(#{1,4}\s)/g, '$1\n$2');

  return (
    <div className="mt-1" style={{ fontSize: 11, color: '#374151', lineHeight: 1.65 }}>
      <style>{`
        .md-body h1 { font-size:14px; font-weight:700; color:#1a1a2e; margin:12px 0 6px; }
        .md-body h2 { font-size:13px; font-weight:700; color:#1a1a2e; margin:10px 0 4px; }
        .md-body h3 { font-size:12px; font-weight:600; color:#1a1a2e; margin:8px 0 3px; }
        .md-body h4 { font-size:11px; font-weight:600; color:#1a1a2e; margin:6px 0 2px; }
        .md-body p { margin:0 0 6px; }
        .md-body ul, .md-body ol { padding-left:18px; margin:4px 0 8px; }
        .md-body li { margin-bottom:2px; }
        .md-body code { padding:1px 5px; border-radius:3px; font-size:10px; background:#f3f4f6; color:#dc2626; }
        .md-body pre { margin:8px 0; padding:10px 12px; border-radius:6px; overflow-x:auto; font-size:10px; background:#f3f4f6; }
        .md-body pre code { padding:0; background:none; color:inherit; font-size:inherit; }
        .md-body table { width:100%; border-collapse:collapse; font-size:10px; margin:8px 0; }
        .md-body th, .md-body td { border:1px solid #e5e7eb; padding:4px 8px; text-align:left; }
        .md-body th { background:#f9fafb; font-weight:600; }
        .md-body hr { margin:12px 0; border:none; border-top:1px solid #e5e7eb; }
        .md-body blockquote { border-left:2px solid #e5e7eb; padding-left:10px; margin:8px 0; opacity:0.8; }
        .md-body a { color:#3b82f6; }
      `}</style>
      <div
        className="md-body"
        style={{ fontSize: 11, color: '#374151', lineHeight: 1.65 }}
        dangerouslySetInnerHTML={{ __html: marked.parse(cleaned, { async: false })! }}
      />
    </div>
  );
}
