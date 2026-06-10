import { useState, useRef, useEffect, useMemo } from 'react';
import { flushSync } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { PipelineState } from '../App';
import PlanCard from './PlanCard';
import ReviewCard from './ReviewCard';
import type { CallGraph } from './MapCanvas';

/* ── Timeline entry ── */
type TimelineEntry =
  | { kind: 'agent-start'; agent: string }
  | { kind: 'tool'; agent: string; tool: string; detail: string }
  | { kind: 'text'; agent: string; text: string }
  | { kind: 'plan'; agent: string; plan: any }
  | { kind: 'graph'; agent: string; nodes: number; edges: number }
  | { kind: 'review'; agent: string; passed: boolean; feedback: string; issues: string[] }
  | { kind: 'system'; text: string };

const AG: Record<string, { name: string; color: string; bg: string }> = {
  planner:  { name: 'Planner',  color: '#6ea8e0', bg: 'rgba(120,169,255,0.04)' },
  mapper:   { name: 'Mapper',   color: '#9685d4', bg: 'rgba(167,139,250,0.04)' },
  reviewer: { name: 'Reviewer', color: '#e0888d', bg: 'rgba(255,179,184,0.04)' },
};

const TOOL_LABEL: Record<string, string> = {
  read_file: 'Read', list_dir: 'List', search: 'Search',
  insert_lines: 'Insert', replace_lines: 'Replace', delete_lines: 'Delete',
  create_file: 'Create', run_shell: 'Run',
};

export default function ChatPanel({ projectPath, onPipelineChange }: {
  projectPath: string | null;
  onPipelineChange: (s: Partial<PipelineState>) => void;
}) {
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const historyRef = useRef<Array<{ role: string; content: string }>>([]);
  const plannerUsedTools = useRef(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [timeline]);

  /* ── Stream ── */
  const streamWithOps = async (
    body: Record<string, any>,
    onToken: (t: string) => void,
    onTools?: (info: { count: number; ops: any[] }) => void,
  ) => {
    const res = await fetch('/api/v1/agent/chat/stream', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, project_path: projectPath }), signal: abortRef.current?.signal,
    });
    const reader = res.body?.getReader();
    if (!reader) return { text: '' };
    const dec = new TextDecoder();
    let buf = '', full = '', finalMessage = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() || '';
      for (const part of parts) {
        const lines = part.split('\n');
        let et = '', ed = '';
        for (const l of lines) {
          if (l.startsWith('event: ')) et = l.slice(7);
          else if (l.startsWith('data: ')) ed = l.slice(6);
        }
        if (et === 'token') { full += ed; onToken(ed); }
        else if (et === 'tools') { try { onTools?.(JSON.parse(ed)); } catch {} }
        else if (et === 'done') { try { finalMessage = JSON.parse(ed).message || ''; } catch {} }
}
    }
    // 处理 buf 中残留的最后一个 SSE 事件
    if (buf.trim()) {
      const lines = buf.trim().split('\n');
      let et = '', ed = '';
      for (const l of lines) {
        if (l.startsWith('event: ')) et = l.slice(7);
        else if (l.startsWith('data: ')) ed = l.slice(6);
      }
      if (et === 'token') { full += ed; onToken(ed); }
      else if (et === 'tools') { try { onTools?.(JSON.parse(ed)); } catch {} }
      else if (et === 'done') { try { finalMessage = JSON.parse(ed).message || ''; } catch {} }
    }
    return { text: finalMessage || full };
  };

  const parseJson = (text: string): any => {
    let m = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (!m) m = text.match(/`json\s*([\s\S]*?)`/);
    if (!m) m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[1] || m[0]); } catch { return null; }
  };

  /* ── Agent loop ── */
  const agentLoop = async (
    agent: string, systemPrompt: string, initialCtx: string,
    _shouldStop: (text: string, ops: any[]) => boolean,
    _allowWrite: boolean, history?: Array<{ role: string; content: string }>,
  ): Promise<{ fullText: string; message: string; textIdx: number }> => {
    const chatHistory: Array<{ role: string; content: string }> = [...(history || [])];
    // Fetch file tree and put everything into history as the first user message
    let fileTree: any = null;
    try { fileTree = await window.codeatlas.file.listDirectory(projectPath!); } catch {}
    const firstMsg = fileTree
      ? `${initialCtx}\n\n${systemPrompt}\n\n【项目文件树】\n${JSON.stringify(fileTree, null, 2).slice(0, 2000)}`
      : `${initialCtx}\n\n${systemPrompt}`;
    chatHistory.push({ role: 'user', content: firstMsg });

    let fullText = '';
    let textIdx = -1;
    setTimeline((prev) => {
      textIdx = prev.length;
      return [...prev, { kind: 'text' as const, agent, text: '' }];
    });

    // Backend handles tool execution internally — frontend just streams and displays
    const { text: message } = await streamWithOps({ history: chatHistory, mode: agent }, (t) => {
      fullText += t;
      setTimeline((prev) => {
        const u = [...prev];
        const target = u[textIdx];
        if (target?.kind === 'text') {
          u[textIdx] = { ...target, text: target.text + t };
        }
        return u;
      });
    }, (toolInfo) => {
      // Tool events: show what the backend is executing
      if (agent === 'planner') plannerUsedTools.current = true;
      for (const op of toolInfo.ops || []) {
        setTimeline((prev) => [...prev, {
          kind: 'tool', agent,
          tool: op.type, detail: op.file || '',
        }]);
      }
    });

    // message = done event's parsed message (XML tags stripped by backend)
    // fullText = raw token accumulation (with XML tags) — fallback only
    // fullText = cumulative tokens from ALL turns (contains JSON even when done is from a later turn)
    // message = done event's parsed message — fallback only
    return { fullText: fullText || message, message: message || '', textIdx };
  };

  /* ── Helpers ── */
  const pushTimeline = (e: TimelineEntry) => setTimeline((p) => [...p, e]);

  /* ════ Pipeline Flow ════
     Planner → Reviewer (validates plan) → Mapper (draws graph)
     If Reviewer fails → retry Planner
     ═══════════════════════════════════════════ */

  /* ════ Planner ════ */
  const runPlanner = async (instruction: string) => {
    if (!projectPath) return;
    setRunning(true);
    plannerUsedTools.current = false;
    abortRef.current = new AbortController();
    const hist = [...historyRef.current, { role: 'user', content: instruction }];

    pushTimeline({ kind: 'agent-start', agent: 'planner' });
    onPipelineChange({ phase: 'planning' });

    const { fullText, message } = await agentLoop('planner', '', '',
      (text) => !!(parseJson(text)?.plan_summary), false, hist);

    const plan = parseJson(fullText);
    console.log(`[Planner] plan=${!!plan} needs_exec=${plan?.needs_execution} steps=${plan?.steps?.length || 0}`);
    hist.push({ role: 'assistant', content: `[Plan] ${plan?.plan_summary || fullText}` });
    historyRef.current = hist;
    // Planner outputs Markdown directly (not JSON), so fallback to raw fullText
    pushTimeline({ kind: 'plan', agent: 'planner', plan: { plan_summary: (plan?.plan_summary || message || fullText), raw: fullText } });

    // Check if Planner actually used tools
    const didReadFiles = plannerUsedTools.current;

    if (!didReadFiles) {
      pushTimeline({ kind: 'system', text: '📖 Planner 未读取文件，跳过后续验证' });
      onPipelineChange({ phase: 'done' });
      setRunning(false);
      return;
    }

    // Step 2: Reviewer validates the Plan BEFORE drawing the graph
    await runReviewPlan(instruction, fullText, plan);
  };

  /* ════ Reviewer (validates Plan only) ════ */
  const runReviewPlan = async (instruction: string, plannerText: string, plan: any) => {
    pushTimeline({ kind: 'agent-start', agent: 'reviewer' });

    const { fullText } = await agentLoop('reviewer', '',
      `【需求】${instruction}\n【Planner输出】${plannerText}\n【关键文件】${(plan?.key_files || []).join(', ') || '无'}\n\n请验证 Planner 的分析是否基于实际代码，结论是否有证据支撑。`,
      () => false, false);

    const review = parseJson(fullText) || { passed: /PASSED/i.test(fullText) && !/FAILED/i.test(fullText), feedback: fullText, issues: [] };
    pushTimeline({ kind: "review", agent: "reviewer", passed: review.passed, feedback: review.feedback || fullText, issues: review.issues || [] });
    historyRef.current.push({ role: 'assistant', content: `[Reviewer] ${fullText}` });

    if (review.passed) {
      // Plan approved → now draw the call graph
      await runMapper(instruction, plan, plannerText);
    } else {
      // Plan rejected → retry Planner
      pushTimeline({ kind: 'system', text: '🔄 审查未通过，重新分析...' });
      setRunning(false);
      setTimeout(() => runPlanner(instruction), 500);
    }
  };

  /* ════ Mapper (draws call graph, only runs after review passes) ════ */
  const runMapper = async (instruction: string, plan: any, plannerText?: string) => {
    pushTimeline({ kind: 'agent-start', agent: 'mapper' });

    const planCtx = plan?.plan_summary
      ? `【计划】${plan.plan_summary}\n【关键文件】${(plan.key_files || []).join(', ')}\n【备注】${plan.notes || ''}`
      : `【Planner 分析】(未输出JSON,以下为原始分析)\n${(plannerText || '').slice(-2000)}`;
    const { fullText } = await agentLoop('mapper', '',
      `【需求】${instruction}\n${planCtx}`,
      (text) => !!(parseJson(text)?.call_graph), false);

    const data = parseJson(fullText);
    console.log(`[Mapper] parsed data:`, data ? `has call_graph=${!!data.call_graph} nodes=${data.call_graph?.nodes?.length || 0}` : 'null', '| last500=', fullText.slice(-500));

    if (data?.call_graph?.nodes?.length > 0) {
      const graph: CallGraph = { nodes: data.call_graph.nodes, edges: data.call_graph.edges || [] };
      pushTimeline({ kind: 'graph', agent: 'mapper', nodes: graph.nodes.length, edges: graph.edges.length });
      flushSync(() => onPipelineChange({ phase: 'done', graph }));
    } else {
      pushTimeline({ kind: 'system', text: '⚠️ Mapper 未生成有效的调用图' });
      onPipelineChange({ phase: 'done' });
    }

    setRunning(false);
  };

  /* ════ Send ════ */
  const handleSend = () => {
    if (!input.trim() || running) return;
    const instruction = input.trim();
    setInput('');
    pushTimeline({ kind: 'text', agent: 'user', text: instruction });
    runPlanner(instruction);
  };

  /* ════ Render ════ */
  return (
    <div className="flex flex-col h-full">
      <header className="shrink-0 px-5 py-3" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
        <h2 className="text-sm font-medium tracking-wide" style={{ color: 'var(--ibm-text-primary)' }}>Agent Pipeline</h2>
        <p className="text-xs mt-0.5 font-light" style={{ color: 'var(--ibm-text-placeholder)' }}>
          Planner&nbsp;→&nbsp;Reviewer&nbsp;→&nbsp;Mapper
        </p>
      </header>

      {/* Timeline */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {timeline.length === 0 && (
          <div className="flex items-center justify-center h-full px-8">
            <div className="text-center" style={{ color: 'var(--ibm-text-placeholder)' }}>
              <svg width="36" height="36" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1" style={{ margin: '0 auto', opacity: 0.4 }}>
                <circle cx="10" cy="12" r="2"/><circle cx="16" cy="18" r="2"/><circle cx="22" cy="12" r="2"/>
                <line x1="12" y1="13" x2="15" y2="17"/><line x1="20" y1="13" x2="17" y2="17"/>
              </svg>
              <p className="mt-4 text-sm font-light tracking-wide">Describe your task</p>
              <p className="mt-1 text-xs font-light opacity-60">The agent pipeline will plan, map, execute, and review</p>
            </div>
          </div>
        )}

        <div className="relative ml-5 mr-5">
          {/* Timeline vertical line — at x=9px (center of 4px dot at x=7) */}
          <div className="absolute top-0 bottom-0" style={{ left: 7, width: 1, background: 'var(--ibm-border-subtle)' }} />

          {timeline.map((entry, i) => (
            <div key={i} className="relative animate-fade-in">
              {entry.kind === 'agent-start' && (
                <div className="flex items-center gap-3 pt-4 pb-1">
                  <span className="w-[15px] h-[15px] flex items-center justify-center shrink-0">
                    <span className="w-[5px] h-[5px] rounded-full" style={{ background: AG[entry.agent]?.color || 'var(--ibm-border)' }} />
                  </span>
                  <span className="text-sm font-medium tracking-wide" style={{ color: AG[entry.agent]?.color || 'var(--ibm-text-secondary)' }}>
                    {AG[entry.agent]?.name || entry.agent}
                  </span>
                </div>
              )}

              {entry.kind === 'tool' && (() => {
                // Group consecutive tool entries — only render on first of the group
                if (i > 0 && timeline[i - 1]?.kind === 'tool') return null;
                const group: TimelineEntry[] = [];
                for (let j = i; j < timeline.length && timeline[j].kind === 'tool'; j++) {
                  group.push(timeline[j]);
                }
                return <CollapsedTools tools={group} color={AG[entry.agent]?.color || '#8b949e'} />;
              })()}

              {/* Text: user messages */}
              {entry.kind === 'text' && entry.agent === 'user' && (
                <div className="flex gap-3 pb-4">
                  <span className="w-[15px] h-[15px] flex items-center justify-center shrink-0">
                    <span className="w-[5px] h-[5px] rounded-full" style={{ background: 'var(--ibm-text-secondary)' }} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <Markdown text={entry.text} muted={false} />
                  </div>
                </div>
              )}

              {/* Agent: streaming text — check if agent has completed later */}
              {entry.kind === 'text' && entry.agent !== 'user' && entry.text && (() => {
                const doneKinds = new Set(['plan', 'graph', 'review']);
                const hasCompleted = timeline.slice(i + 1).some(
                  (e: any) => e.agent === entry.agent && doneKinds.has(e.kind)
                );
                return (
                  <AgentBlock text={entry.text} color={AG[entry.agent]?.color || '#8b949e'} name={AG[entry.agent]?.name || entry.agent} status={hasCompleted ? 'done' : 'thinking'} />
                );
              })()}

              {/* Agent: plan result */}
              {entry.kind === 'plan' && (
                <AgentBlock color={AG.planner.color} name="Planner" status="done">
                  <PlanCard planSummary={entry.plan?.plan_summary || ''} color={AG.planner.color} />
                </AgentBlock>
              )}

              {/* Agent: graph summary */}
              {entry.kind === 'graph' && (
                <AgentBlock color={AG.mapper.color} name="Mapper" status="done">
                  <div className="flex items-center gap-3 pb-2">
                    <span className="text-xs tracking-wide" style={{ color: AG.mapper.color }}>
                      Call graph &nbsp;
                      <span style={{ color: 'var(--ibm-text-secondary)' }}>{entry.nodes} nodes, {entry.edges} edges</span>
                    </span>
                  </div>
                </AgentBlock>
              )}

              {/* Agent: review result */}
              {entry.kind === 'review' && (
                <AgentBlock color={AG.reviewer.color} name="Reviewer" status={entry.passed ? 'done' : 'failed'} doneLabel="审核结果">
                  <ReviewCard passed={entry.passed} feedback={entry.feedback} issues={entry.issues} color={AG.reviewer.color} />
                </AgentBlock>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Input */}
      <footer className="shrink-0 px-4 py-3" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
        <div className="flex items-end gap-3 p-2 rounded-lg" style={{ background: 'var(--ibm-layer-01)', border: '1px solid var(--color-border-default)' }}>
          <textarea value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="Describe what you want to build or fix..."
            disabled={running} rows={2}
            className="flex-1 py-1 text-sm bg-transparent outline-none resize-none min-h-[44px] focus:outline-none focus:ring-0"
            style={{ fontFamily: 'var(--ibm-font)', color: 'var(--ibm-text-primary)' }}
            onInput={(e) => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px'; }}
            onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault(); handleSend();
                }
              }}
          />
          <div className="flex items-center gap-2 shrink-0">
            {running ? (
              <button onClick={() => { abortRef.current?.abort(); setRunning(false); }}
                className="px-3 py-2 rounded-md text-xs font-medium transition-colors"
                style={{ color: 'var(--ibm-error)', border: '1px solid var(--ibm-error)', background: 'transparent' }}>
                Stop
              </button>
            ) : (
              <button onClick={handleSend} disabled={!input.trim()}
                className="w-9 h-9 flex items-center justify-center rounded-md transition-all disabled:opacity-20"
                style={{ background: input.trim() ? 'var(--ibm-primary)' : 'var(--ibm-layer-03)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
                </svg>
              </button>
            )}
          </div>
        </div>
        <div className="flex justify-between mt-2 px-2">
          <span className="text-caption" style={{ color: 'var(--ibm-text-disabled)' }}>
            Enter to send, Shift+Enter for new line
          </span>
          <span className="text-caption" style={{ color: 'var(--ibm-text-disabled)' }}>
            {input.length} / 4000
          </span>
        </div>
      </footer>
    </div>
  );
}

/* ── Collapsible tool group ── */

function CollapsedTools({ tools, color }: { tools: TimelineEntry[]; color: string }) {
  const [open, setOpen] = useState(false);
  if (tools.length === 0) return null;
  return (
    <div className="pb-1">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left py-0.5 transition-colors hover:bg-white/[0.02]">
        <span className="w-[15px] flex items-center justify-center shrink-0">
          <span className="w-1 h-1 rounded-full" style={{ background: color }} />
        </span>
        <span className="text-caption" style={{ color: 'var(--color-text-muted)' }}>
          🔧 {tools.length} 个工具操作
        </span>
        <span className="text-caption" style={{ color: 'var(--color-text-disabled)' }}>
          {tools.slice(0, 3).map((t: any) => TOOL_LABEL[t.tool] || t.tool).join(', ')}{tools.length > 3 ? '...' : ''}
        </span>
        <svg width="8" height="8" viewBox="0 0 8 8" className="ml-auto"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
          <path d="M2 3 L4 5 L6 3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {open && (
        <div className="ml-5 mt-0.5 space-y-0">
          {tools.map((t: any, j: number) => (
            <div key={j} className="flex items-center gap-2 py-[1px]">
              <span className="text-caption font-mono" style={{ color: 'var(--color-text-placeholder)' }}>
                {TOOL_LABEL[t.tool] || t.tool}
              </span>
              <span className="text-caption truncate" style={{ color: 'var(--color-text-secondary)' }}>
                {t.detail}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Agent collapsible block (streaming text or result card) ── */

function AgentBlock({ text, color, name, status, doneLabel, children }: {
  text?: string; color: string; name: string;
  status?: 'thinking' | 'done' | 'failed';
  doneLabel?: string;
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(!!children);
  const label = status === 'failed' ? '未通过' : status === 'done' ? (doneLabel || '完成') : text ? `${Math.round((text || '').length / 100)} 字` : '思考中...';
  const spinner = status === 'thinking' || (!status && (text || '').length < 10);

  return (
    <div className="flex gap-3 pb-4 animate-fade-in">
      <span className="w-[15px] h-[15px] flex items-center justify-center shrink-0 mt-0.5">
        <span className="w-[7px] h-[7px] rounded-full" style={{
          background: color,
          animation: spinner ? 'pulse-dot 1.5s infinite' : 'none',
        }} />
      </span>

      <div className="flex-1 min-w-0">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 w-full text-left rounded-lg px-3 py-2 transition-colors hover:bg-white/[0.03]"
          style={{ background: color + '08', border: `1px solid ${color}15` }}>
          {spinner ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"
              className="animate-spin-slow shrink-0">
              <circle cx="12" cy="12" r="10" strokeOpacity="0.2" />
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
            </svg>
          ) : (
            <span className="text-xs shrink-0" style={{ color }}>
              {status === 'failed' ? '✕' : status === 'done' ? '✓' : '◉'}
            </span>
          )}
          <span className="text-xs font-medium" style={{ color }}>{name}</span>
          <span className="text-xs" style={{ color: status === 'failed' ? 'var(--color-status-problem)' : 'var(--color-text-muted)' }}>{label}</span>
          <svg width="10" height="10" viewBox="0 0 8 8" className="ml-auto shrink-0"
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
            <path d="M2 3 L4 5 L6 3" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        {expanded && (
          text ? (
            <div className="mt-2 ml-1 pl-4 border-l-2" style={{ borderColor: color + '30' }}>
              <Markdown text={text} muted />
            </div>
          ) : (
            <div className="mt-2">{children}</div>
          )
        )}
      </div>
    </div>
  );
}

/* ── Markdown renderer ── */

function Markdown({ text, muted }: { text: string; muted?: boolean }) {
  const cleaned = useMemo(() => {
    if (!text) return '';
    return text
      .replace(/<(list-dir|read-file|run-shell|update|create-file|delete-file|search)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<(list-dir|read-file|run-shell|update|create-file|delete-file|search)\b[^>]*\/>/gi, '')
      .replace(/<done>[^<]*<\/done>/gi, '')
      .replace(/<step-done[^>]*>[^<]*<\/step-done>/gi, '')
      .replace(/<all-done>[^<]*<\/all-done>/gi, '')
      .replace(/<final\/>/gi, '')
      .replace(/\n{3,}/g, '\n\n').trim();
  }, [text]);

  if (!cleaned) return null;

  return (
    <div className="text-body leading-relaxed" style={{ color: muted ? 'var(--ibm-text-placeholder)' : 'var(--ibm-text-secondary)' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}
        components={{
          code: ({ className, children, ...props }: any) => {
            const inline = !className;
            if (inline) return <code className="inline-code" {...props}>{children}</code>;
            return <pre className="my-2 p-3 rounded-md overflow-x-auto text-xs" style={{ background: 'var(--ibm-layer-01)', border: '1px solid var(--ibm-border-subtle)' }}><code className={className} {...props}>{children}</code></pre>;
          },
          p: ({ children }: any) => <p className="mb-1 last:mb-0">{children}</p>,
          ul: ({ children }: any) => <ul className="list-disc pl-5 mb-1 space-y-0.5">{children}</ul>,
          ol: ({ children }: any) => <ol className="list-decimal pl-5 mb-1 space-y-0.5">{children}</ol>,
          h1: ({ children }: any) => <h1 className="text-base font-semibold mt-3 mb-1">{children}</h1>,
          h2: ({ children }: any) => <h2 className="text-sm font-semibold mt-2 mb-1">{children}</h2>,
          h3: ({ children }: any) => <h3 className="text-sm font-medium mt-2 mb-1">{children}</h3>,
          blockquote: ({ children }: any) => <blockquote className="border-l-2 pl-3 my-1 italic opacity-70" style={{ borderColor: 'var(--ibm-border)' }}>{children}</blockquote>,
          a: ({ href, children }: any) => <a href={href} className="md-link" target="_blank" rel="noopener">{children}</a>,
          hr: () => <hr className="my-2" style={{ borderColor: 'var(--ibm-border-subtle)' }} />,
        }}>
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}
