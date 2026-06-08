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
  ): Promise<{ fullText: string; textIdx: number }> => {
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
    return { fullText: message || fullText, textIdx };
  };

  /* ── Helpers ── */
  const pushTimeline = (e: TimelineEntry) => setTimeline((p) => [...p, e]);

  /* ════ Planner ════ */
  const runPlanner = async (instruction: string) => {
    if (!projectPath) return;
    setRunning(true);
    plannerUsedTools.current = false;
    abortRef.current = new AbortController();
    const hist = [...historyRef.current, { role: 'user', content: instruction }];

    pushTimeline({ kind: 'agent-start', agent: 'planner' });
    onPipelineChange({ phase: 'planning' });

    const { fullText } = await agentLoop('planner', '', '',
      (text) => !!(parseJson(text)?.plan_summary), false, hist);

    const plan = parseJson(fullText);
    console.log(`[Planner] plan=${!!plan} needs_exec=${plan?.needs_execution} steps=${plan?.steps?.length || 0}`);
    hist.push({ role: 'assistant', content: `[Plan] ${plan?.plan_summary || fullText}` });
    historyRef.current = hist;
    pushTimeline({ kind: 'plan', agent: 'planner', plan: plan || { plan_summary: fullText } });

    // Check if Planner actually used tools — use ref since timeline state may be stale
    const didReadFiles = plannerUsedTools.current;

    if (!didReadFiles) {
      pushTimeline({ kind: 'system', text: '📖 Planner 未读取文件，跳过后续验证' });
      onPipelineChange({ phase: 'done' });
      setRunning(false);
      return;
    }

    // Always run Mapper — it decides whether to draw or skip
    await runMapper(instruction, plan, fullText);
  };

  /* ════ Mapper ════ */
  const runMapper = async (instruction: string, plan: any, plannerText?: string) => {
    pushTimeline({ kind: 'agent-start', agent: 'mapper' });

    const planCtx = plan?.plan_summary
      ? `【计划】${plan.plan_summary}\n【关键文件】${(plan.key_files || []).join(', ')}\n【备注】${plan.notes || ''}`
      : `【Planner 分析】(未输出JSON,以下为原始分析)\n${(plannerText || '').slice(-2000)}`;
    const { fullText } = await agentLoop('mapper',
      `【角色: Mapper / 调用链路绘制者】

**你只能读取代码，不能修改任何文件。**

根据 Planner 的分析，读取相关代码文件，绘制完整的调用链路图。

【节点 status 标注规则 — 必须严格区分】
- **existing**：正常的现有代码，不需要修改
- **problem**：问题或 bug 所在的具体位置（Planner 指出的问题点）
- **planned_change**：需要修改的代码（Planner steps 里涉及的文件/函数）
- **planned_new**：需要新增的代码（如果需要新建文件或函数）

【边 status 标注规则】
- **existing**：正常的调用关系
- **new**：需要新增的调用关系
- **error**：有问题的调用关系（比如调用了不存在的函数、产生 ReferenceError 的调用）

【要求】
- 必须读取 Planner 提到的关键文件，验证文件名和函数签名
- 先画出现有调用链（existing），再在现有链上标注问题点和修改点
- 每个 Planner step 对应至少一个 planned_change 或 planned_new 节点
- edges 必须覆盖完整的调用路径，包括 IPC 通道、事件监听等跨文件关系

【输出格式】严格 JSON：
\`\`\`json
{
  "call_graph": {
    "nodes": [
      {"id":"a","label":"按钮 onClick","kind":"component","status":"existing","detail":"点击关闭按钮触发 action('close')","file":"src/components/TitleBar.tsx"},
      {"id":"b","label":"ipcMain window:close","kind":"function","status":"problem","detail":"调用 app.quit() 跳过正常生命周期","file":"electron/main.ts"},
      {"id":"c","label":"修复: mainWindow.close()","kind":"function","status":"planned_change","detail":"改为先 close 窗口，走正常退出流程","file":"electron/main.ts"}
    ],
    "edges": [
      {"from":"a","to":"b","label":"IPC invoke","status":"existing"},
      {"from":"b","to":"c","label":"替换为","status":"new"}
    ]
  }
}
\`\`\``,
      `【需求】${instruction}\n${planCtx}`,
      (text) => !!(parseJson(text)?.call_graph), false);

    const data = parseJson(fullText);
    console.log(`[Mapper] parsed data:`, data ? `has call_graph=${!!data.call_graph} nodes=${data.call_graph?.nodes?.length || 0}` : 'null', '| last500=', fullText.slice(-500));
    if (data?.call_graph?.nodes?.length > 0) {
      const graph: CallGraph = { nodes: data.call_graph.nodes, edges: data.call_graph.edges || [] };
      console.log(`[Mapper] Graph ready: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
      console.log(`[Mapper] First node:`, JSON.stringify(graph.nodes[0]));
      pushTimeline({ kind: 'graph', agent: 'mapper', nodes: graph.nodes.length, edges: graph.edges.length });
      // Save context for execute-on-demand
      flushSync(() => onPipelineChange({ phase: 'planning', graph }));
      console.log(`[Mapper] onPipelineChange called with graph (flushSync)`);
      // Don't auto-execute — user reviews the map first, then clicks execute
      await runReviewOnly(instruction, plannerText || '', plan);
    } else {
      // Mapper skipped or no valid graph — still run Reviewer
      console.log(`[Mapper] Skipped or no call_graph, running reviewer`);
      await runReviewOnly(instruction, plannerText || '', plan);
    }
  };

  /* ════ ReviewOnly ════ */
  const runReviewOnly = async (instruction: string, plannerText: string, plan: any) => {
    pushTimeline({ kind: 'agent-start', agent: 'reviewer' });

    const { fullText } = await agentLoop('reviewer', '',
      `【需求】${instruction}\n【Planner输出】${plannerText}\n【关键文件】${(plan?.key_files || []).join(', ') || '无'}`,
      () => false, false);

    const review = parseJson(fullText) || { passed: /PASSED/i.test(fullText) && !/FAILED/i.test(fullText), feedback: fullText, issues: [] };
    pushTimeline({ kind: "review", agent: "reviewer", passed: review.passed, feedback: review.feedback || fullText, issues: review.issues || [] });
    historyRef.current.push({ role: 'assistant', content: `[Reviewer]
${fullText}` });
    if (review.passed) {
      onPipelineChange({ phase: 'done' });
      setRunning(false);
    } else {
      // FAILED → retry Planner, append to existing timeline
      pushTimeline({ kind: 'system', text: '🔄 审查未通过，重新分析...' });
      setRunning(false);
      setTimeout(() => runPlanner(instruction), 500);
    }
  };

  /* ════ Reviewer (with execution) ════ — reserved for future execute feature */
  // @ts-expect-error — reserved for manual execution trigger
  const runReviewer = async (instruction: string, plan: any, execText: string, graph: CallGraph) => {
    pushTimeline({ kind: 'agent-start', agent: 'reviewer' });
    onPipelineChange({ phase: 'reviewing', graph });

    const { fullText } = await agentLoop('reviewer_exec', '',
      `【需求】${instruction}\n【计划】${JSON.stringify(plan.steps || [])}\n【关键文件】${(plan.key_files || []).join(', ')}\n【执行输出】${execText}`,
      () => false, false);

    const review = parseJson(fullText) || { passed: /PASSED/i.test(fullText) && !/FAILED/i.test(fullText), feedback: fullText, issues: [] };
    pushTimeline({ kind: "review", agent: "reviewer", passed: review.passed, feedback: review.feedback || fullText, issues: review.issues || [] });
    historyRef.current.push({ role: 'assistant', content: `[Reviewer]
${fullText}` });
    if (review.passed) {
      onPipelineChange({ phase: 'done', graph });
      setRunning(false);
    } else {
      pushTimeline({ kind: 'system', text: '🔄 审查未通过，重新分析...' });
      setRunning(false);
      setTimeout(() => runPlanner(instruction), 500);
    }
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
      <header className="shrink-0 px-5 py-3" style={{ borderBottom: '1px solid var(--ibm-border-subtle)' }}>
        <h2 className="text-sm font-medium tracking-wide" style={{ color: 'var(--ibm-text-primary)' }}>Agent Pipeline</h2>
        <p className="text-xs mt-0.5 font-light" style={{ color: 'var(--ibm-text-placeholder)' }}>
          Planner&nbsp;→&nbsp;Mapper&nbsp;→&nbsp;Reviewer
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
                  <span className="text-[12px] font-medium tracking-wide" style={{ color: AG[entry.agent]?.color || 'var(--ibm-text-secondary)' }}>
                    {AG[entry.agent]?.name || entry.agent}
                  </span>
                </div>
              )}

              {entry.kind === 'tool' && (
                <div className="flex items-center gap-3 py-[2px]">
                  <span className="w-[15px] flex items-center justify-center shrink-0">
                    <span className="w-1 h-1 rounded-full" style={{ background: 'var(--ibm-border-strong)' }} />
                  </span>
                  <span className="text-[11px] font-mono" style={{ color: 'var(--ibm-text-placeholder)' }}>
                    {TOOL_LABEL[entry.tool] || entry.tool}
                  </span>
                  <span className="text-[11px] truncate" style={{ color: 'var(--ibm-text-secondary)' }}>
                    {entry.detail}
                  </span>
                </div>
              )}

              {/* Text: only user messages use plain markdown. Agents use cards. */}
              {entry.kind === 'text' && entry.agent === 'user' && (
                <div className="flex gap-3 pb-4">
                  {entry.agent === 'user' ? (
                    <span className="w-[15px] h-[15px] flex items-center justify-center shrink-0">
                      <span className="w-[5px] h-[5px] rounded-full" style={{ background: 'var(--ibm-text-secondary)' }} />
                    </span>
                  ) : (
                    <span className="w-[15px] shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <Markdown text={entry.text} muted={false} />
                  </div>
                </div>
              )}

              {entry.kind === 'plan' && (
                <PlanCard planSummary={entry.plan?.plan_summary || ''} color={AG.planner.color} />
              )}

              {entry.kind === 'graph' && (
                <div className="flex gap-3 pb-3">
                  <span className="w-[15px] shrink-0" />
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] tracking-wide" style={{ color: AG.mapper.color }}>
                      Call graph &nbsp;
                      <span style={{ color: 'var(--ibm-text-secondary)' }}>{entry.nodes} nodes, {entry.edges} edges</span>
                    </span>
                  </div>
                </div>
              )}

              {entry.kind === 'review' && (
                <ReviewCard passed={entry.passed} feedback={entry.feedback} issues={entry.issues} color={AG.reviewer.color} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Input */}
      <footer className="shrink-0 px-4 py-3" style={{ borderTop: '1px solid var(--ibm-border-subtle)' }}>
        <div className="flex items-end gap-3 p-2 rounded-lg" style={{ background: 'var(--ibm-layer-01)', border: '1px solid var(--ibm-border)' }}>
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
          <span className="text-[10px]" style={{ color: 'var(--ibm-text-disabled)' }}>
            Enter to send, Shift+Enter for new line
          </span>
          <span className="text-[10px]" style={{ color: 'var(--ibm-text-disabled)' }}>
            {input.length} / 4000
          </span>
        </div>
      </footer>
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
      .replace(/\n{3,}/g, '\n\n').trim();
  }, [text]);

  if (!cleaned) return null;

  return (
    <div className="text-[13px] leading-relaxed" style={{ color: muted ? 'var(--ibm-text-placeholder)' : 'var(--ibm-text-secondary)' }}>
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
