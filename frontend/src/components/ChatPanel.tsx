import { useState, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { PipelineState } from '../App';
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
  planner:  { name: 'Planner',  color: '#78a9ff', bg: 'rgba(120,169,255,0.06)' },
  mapper:   { name: 'Mapper',   color: '#a78bfa', bg: 'rgba(167,139,250,0.06)' },
  executor: { name: 'Executor', color: '#6fdc8c', bg: 'rgba(111,220,140,0.06)' },
  reviewer: { name: 'Reviewer', color: '#ffb3b8', bg: 'rgba(255,179,184,0.06)' },
};

const TOOL_LABEL: Record<string, string> = {
  read_file: 'Read', list_dir: 'List', search: 'Search',
  insert_lines: 'Insert', replace_lines: 'Replace', delete_lines: 'Delete',
  create_file: 'Create', run_shell: 'Run',
};

export default function ChatPanel({ projectPath, onPipelineChange }: {
  projectPath: string | null;
  onPipelineChange: (s: PipelineState) => void;
}) {
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const historyRef = useRef<Array<{ role: string; content: string }>>([]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [timeline]);

  /* ── Stream ── */
  const streamWithOps = async (body: Record<string, any>, onToken: (t: string) => void) => {
    const res = await fetch('/api/v1/agent/chat/stream', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: abortRef.current?.signal,
    });
    const reader = res.body?.getReader();
    if (!reader) return { text: '', ops: [] as any[] };
    const dec = new TextDecoder();
    let buf = '', full = '', ops: any[] = [];
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
        else if (et === 'done') { try { ops = JSON.parse(ed).operations || []; } catch {} }
      }
    }
    return { text: full, ops };
  };

  const parseJson = (text: string): any => {
    let m = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (!m) m = text.match(/`json\s*([\s\S]*?)`/);
    if (!m) m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[1] || m[0]); } catch { return null; }
  };

  /* ── Execute a single op ── */
  const execSingleOp = async (op: any): Promise<{ detail: string; output?: string }> => {
    try {
      let fp = op.file || '';
      if (fp && !/^[a-zA-Z]:[\\/]/.test(fp) && projectPath) {
        fp = projectPath.replace(/\\/g, '/') + '/' + fp.replace(/^[\\/]+/, '');
      }
      switch (op.type) {
        case 'read_file': {
          const label = op.start_line ? `${fp}:L${op.start_line}-${op.end_line || 'end'}` : fp;
          const fc = await window.codeatlas.file.readFile(fp, op.start_line, op.end_line);
          return { detail: label, output: `=== ${label} ===\n${fc.content}\n` };
        }
        case 'list_dir': {
          await window.codeatlas.file.listDirectory(fp); // validate
          return { detail: fp || '.' };
        }
        case 'insert_lines':
          await window.codeatlas.file.insertLines(fp, op.after_line || 0, op.content || '');
          return { detail: `${fp} +L${op.after_line}` };
        case 'replace_lines':
          await window.codeatlas.file.replaceLines(fp, op.start_line || 1, op.end_line || 1, op.content || '');
          return { detail: `${fp} L${op.start_line}-${op.end_line}` };
        case 'delete_lines':
          await window.codeatlas.file.deleteLines(fp, op.start_line || 1, op.end_line || 1);
          return { detail: `${fp} L${op.start_line}-${op.end_line}` };
        case 'create_file':
          await window.codeatlas.file.writeFile(fp, op.content || '');
          return { detail: fp };
        case 'run_shell': {
          const cmd = op.content || '';
          if (!cmd) return { detail: 'shell (empty)' };
          const out = await new Promise<string>((resolve) => {
            const sid = window.codeatlas.shell.run(cmd); let o = '';
            window.codeatlas.shell.onData((id, d) => { if (id === sid) o += d; });
            window.codeatlas.shell.onDone((id, code) => { if (id === sid) resolve(`\n=== ${cmd} (exit ${code}) ===\n${o}\n`); });
            setTimeout(() => resolve(`\n[timeout: ${cmd}]\n`), 15000);
          });
          return { detail: cmd.slice(0, 60), output: out };
        }
        default: return { detail: op.type };
      }
    } catch { return { detail: 'failed' }; }
  };

  /* ── Agent loop ── */
  const agentLoop = async (
    agent: string, systemPrompt: string, initialCtx: string,
    shouldStop: (text: string, ops: any[]) => boolean,
    allowWrite: boolean, history?: Array<{ role: string; content: string }>,
  ): Promise<string> => {
    let fullText = '';
    let body: Record<string, any> = { instruction: `${initialCtx}\n\n${systemPrompt}`, file_tree: null, history: history || [] };
    try { body.file_tree = await window.codeatlas.file.listDirectory(projectPath!); } catch {}

    for (let round = 0; round < 12; round++) {
      // Start a new text segment
      let currentText = '';
      const { text, ops } = await streamWithOps(body, (t) => {
        currentText += t;
        // Update the last text entry
        setTimeline((prev) => {
          const u = [...prev];
          const last = u[u.length - 1];
          if (last?.kind === 'text' && last.agent === agent) {
            u[u.length - 1] = { ...last, text: last.text + t };
          }
          return u;
        });
      });
      fullText += text;

      if (shouldStop(fullText, ops)) break;

      // Show tool calls on timeline
      const readOps = ops.filter((o: any) => allowWrite ? true : ['read_file', 'list_dir', 'search'].includes(o.type));
      if (readOps.length === 0) break;

      let feedback = '';
      for (const op of readOps) {
        setTimeline((prev) => [...prev, {
          kind: 'tool', agent,
          tool: op.type, detail: op.file || op.content?.slice(0, 40) || op.type,
        }]);
        const r = await execSingleOp(op);
        if (r.output) feedback += r.output;
      }

      if (!feedback && !allowWrite) break;

      body = {
        instruction: `结果如下，请继续：\n${feedback}`,
        file_tree: body.file_tree, history: history || [],
      };
    }
    return fullText;
  };

  /* ── Helpers ── */
  const pushTimeline = (e: TimelineEntry) => setTimeline((p) => [...p, e]);

  /* ════ Planner ════ */
  const runPlanner = async (instruction: string) => {
    if (!projectPath) return;
    setRunning(true);
    abortRef.current = new AbortController();
    const projName = projectPath.split(/[\\/]/).pop() || '';
    const hist = [...historyRef.current, { role: 'user', content: instruction }];

    pushTimeline({ kind: 'agent-start', agent: 'planner' });
    onPipelineChange({ phase: 'planning', graph: null });

    const fullText = await agentLoop('planner',
      `【角色: Planner】理解需求,读取代码,制定计划。输出JSON:\n\`\`\`json\n{"plan_summary":"概述","needs_execution":true/false,"steps":[{"id":1,"title":"...","description":"具体操作","deps":[]}],"key_files":["文件"],"notes":"给Mapper的备注"}\n\`\`\``,
      `【项目: ${projName}】\n用户需求: ${instruction}\n\n请先读文件了解结构。`,
      (text) => !!(parseJson(text)?.plan_summary), false, hist);

    const plan = parseJson(fullText);
    hist.push({ role: 'assistant', content: `[Plan] ${plan?.plan_summary || fullText.slice(0, 300)}` });
    historyRef.current = hist;
    pushTimeline({ kind: 'plan', agent: 'planner', plan });

    if (plan?.needs_execution && plan.steps?.length > 0) {
      await runMapper(instruction, plan);
    } else {
      await runReviewOnly(instruction, fullText, plan);
    }
  };

  /* ════ Mapper ════ */
  const runMapper = async (instruction: string, plan: any) => {
    pushTimeline({ kind: 'agent-start', agent: 'mapper' });
    onPipelineChange({ phase: 'planning', graph: null });

    const fullText = await agentLoop('mapper',
      `【角色: Mapper】根据Planner计划,读取代码,绘制调用链路图。输出JSON:\n\`\`\`json\n{"call_graph":{"nodes":[{"id":"a","label":"main","kind":"file","status":"existing","detail":"入口","file":"src/main.ts"}],"edges":[{"from":"a","to":"b","label":"calls","status":"existing"}]}}\n\`\`\``,
      `【需求】${instruction}\n【计划】${plan.plan_summary}\n【关键文件】${(plan.key_files || []).join(', ')}\n【备注】${plan.notes || ''}`,
      (text) => !!(parseJson(text)?.call_graph), false);

    const data = parseJson(fullText);
    if (data?.call_graph?.nodes?.length > 0) {
      const graph: CallGraph = { nodes: data.call_graph.nodes, edges: data.call_graph.edges || [] };
      pushTimeline({ kind: 'graph', agent: 'mapper', nodes: graph.nodes.length, edges: graph.edges.length });
      onPipelineChange({ phase: 'planning', graph });
      await runExecutor(instruction, plan, graph);
    } else {
      onPipelineChange({ phase: 'done', graph: null });
      setRunning(false);
    }
  };

  /* ════ Executor ════ */
  const runExecutor = async (instruction: string, plan: any, graph: CallGraph) => {
    pushTimeline({ kind: 'agent-start', agent: 'executor' });
    onPipelineChange({ phase: 'executing', graph });

    const stepsText = (plan.steps || []).map((s: any) => `[${s.id}] ${s.title}: ${s.description}`).join('\n');
    const fullText = await agentLoop('executor',
      '【角色: Executor】按计划执行。读文件、改代码、运行命令。', `【需求】${instruction}\n【计划】\n${stepsText}`, () => false, true);

    const execData = parseJson(fullText);
    const updatedGraph = execData?.call_graph
      ? { nodes: execData.call_graph.nodes.map((n: any) => n.status === 'planned_change' || n.status === 'planned_new' ? { ...n, status: 'done' } : n), edges: execData.call_graph.edges || [] }
      : { ...graph, nodes: graph.nodes.map((n: any) => n.status === 'planned_change' || n.status === 'planned_new' ? { ...n, status: 'done' } : n) };
    onPipelineChange({ phase: 'executing', graph: updatedGraph });
    await runReviewer(instruction, plan, fullText, updatedGraph);
  };

  /* ════ ReviewOnly ════ */
  const runReviewOnly = async (instruction: string, plannerText: string, plan: any) => {
    pushTimeline({ kind: 'agent-start', agent: 'reviewer' });
    onPipelineChange({ phase: 'reviewing', graph: null });

    const fullText = await agentLoop('reviewer',
      '【角色: Reviewer】独立验证Planner的回答。必须读文件确认。输出JSON:\n```json\n{"passed":true/false,"feedback":"意见","issues":[]}\n```',
      `【需求】${instruction}\n【Planner输出】${plannerText.slice(-3000)}\n【关键文件】${(plan?.key_files || []).join(', ') || '无'}`,
      (text) => !!(parseJson(text)?.passed !== undefined), false);

    const review = parseJson(fullText) || { passed: true, feedback: '', issues: [] };
    pushTimeline({ kind: 'review', agent: 'reviewer', passed: review.passed, feedback: review.feedback || '', issues: review.issues || [] });
    onPipelineChange({ phase: review.passed ? 'done' : 'rejected', graph: null });
    historyRef.current.push({ role: 'assistant', content: review.passed ? `✓ Passed` : `✗ Rejected: ${review.issues?.join('; ')}` });
    setRunning(false);
  };

  /* ════ Reviewer (with execution) ════ */
  const runReviewer = async (instruction: string, plan: any, execText: string, graph: CallGraph) => {
    pushTimeline({ kind: 'agent-start', agent: 'reviewer' });
    onPipelineChange({ phase: 'reviewing', graph });

    const fullText = await agentLoop('reviewer',
      '【角色: Reviewer】独立审查。Plan可能错,执行可能漏。1.Plan对不对 2.执行对不对 3.结果是否符合需求。输出JSON:\n```json\n{"passed":true/false,"plan_correct":true/false,"feedback":"意见","issues":[]}\n```',
      `【需求】${instruction}\n【计划】${JSON.stringify(plan.steps || [])}\n【关键文件】${(plan.key_files || []).join(', ')}\n【执行输出】${execText.slice(-3000)}`,
      (text) => !!(parseJson(text)?.passed !== undefined), false);

    const review = parseJson(fullText) || { passed: true, feedback: '', issues: [] };
    pushTimeline({ kind: 'review', agent: 'reviewer', passed: review.passed, feedback: review.feedback || '', issues: review.issues || [] });
    onPipelineChange({ phase: review.passed ? 'done' : 'rejected', graph });
    historyRef.current.push({ role: 'assistant', content: review.passed ? `✓ Passed` : `✗ Rejected: ${review.issues?.join('; ')}` });
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
      <header className="shrink-0 px-5 py-3" style={{ borderBottom: '1px solid var(--ibm-border-subtle)' }}>
        <h2 className="text-sm font-medium tracking-wide" style={{ color: 'var(--ibm-text-primary)' }}>Agent Pipeline</h2>
        <p className="text-xs mt-0.5 font-light" style={{ color: 'var(--ibm-text-placeholder)' }}>
          Planner&nbsp;→&nbsp;Mapper&nbsp;→&nbsp;Executor&nbsp;→&nbsp;Reviewer
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
                  <span className="text-[13px] font-medium tracking-wide" style={{ color: AG[entry.agent]?.color || 'var(--ibm-text-primary)' }}>
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

              {entry.kind === 'text' && (
                <div className="flex gap-3 pb-4">
                  {entry.agent === 'user' ? (
                    <span className="w-[15px] h-[15px] flex items-center justify-center shrink-0">
                      <span className="w-[5px] h-[5px] rounded-full" style={{ background: 'var(--ibm-text-secondary)' }} />
                    </span>
                  ) : (
                    <span className="w-[15px] shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <Markdown text={entry.text} muted={entry.agent === 'system'} />
                  </div>
                </div>
              )}

              {entry.kind === 'plan' && (
                <div className="flex gap-3 pb-3">
                  <span className="w-[15px] shrink-0" />
                  <div className="flex-1 min-w-0 px-3 py-2 rounded text-xs" style={{ background: AG.planner.bg }}>
                    <span className="font-medium tracking-wide" style={{ color: AG.planner.color }}>PLAN</span>
                    <span className="ml-2" style={{ color: 'var(--ibm-text-secondary)' }}>{entry.plan?.plan_summary}</span>
                    {(entry.plan?.steps || []).map((s: any) => (
                      <div key={s.id} className="mt-1.5 ml-1 flex gap-2">
                        <span className="font-medium shrink-0" style={{ color: 'var(--ibm-text-primary)' }}>{s.id}.</span>
                        <span style={{ color: 'var(--ibm-text-secondary)' }}>{s.title} — {s.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {entry.kind === 'graph' && (
                <div className="flex gap-3 pb-3">
                  <span className="w-[15px] shrink-0" />
                  <span className="text-[11px] tracking-wide" style={{ color: AG.mapper.color }}>
                    Call graph &nbsp;
                    <span style={{ color: 'var(--ibm-text-secondary)' }}>{entry.nodes} nodes, {entry.edges} edges</span>
                  </span>
                </div>
              )}

              {entry.kind === 'review' && (
                <div className="flex gap-3 pb-4">
                  <span className="w-[15px] shrink-0" />
                  <div className="flex-1 min-w-0 px-3 py-2 rounded text-xs" style={{
                    background: entry.passed ? 'rgba(36,161,72,0.06)' : 'rgba(218,30,40,0.06)',
                  }}>
                    <span className="font-medium tracking-wide" style={{
                      color: entry.passed ? 'var(--ibm-success)' : 'var(--ibm-error)',
                    }}>
                      {entry.passed ? 'PASSED' : 'REJECTED'}
                    </span>
                    {entry.feedback && (
                      <span className="ml-2" style={{ color: 'var(--ibm-text-secondary)' }}>{entry.feedback}</span>
                    )}
                    {entry.issues.length > 0 && (
                      <ul className="mt-1 space-y-0.5" style={{ color: 'var(--ibm-text-secondary)' }}>
                        {entry.issues.map((issue, j) => <li key={j}>— {issue}</li>)}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Input */}
      <footer className="shrink-0 p-3" style={{ borderTop: '1px solid var(--ibm-border-subtle)' }}>
        <div className="flex gap-2">
          {running && (
            <button onClick={() => { abortRef.current?.abort(); setRunning(false); }}
              className="shrink-0 px-3 py-2 rounded-md text-xs font-medium"
              style={{ color: 'var(--ibm-error)', border: '1px solid var(--ibm-error)', background: 'transparent' }}>
              Stop
            </button>
          )}
          <textarea value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="Describe what you want to build or fix..."
            disabled={running} rows={1}
            className="flex-1 px-3 py-2 text-sm bg-transparent outline-none resize-none rounded-md"
            style={{ border: '1px solid var(--ibm-border)', fontFamily: 'var(--ibm-font)', color: 'var(--ibm-text-primary)', background: 'var(--ibm-layer-01)' }}
            onInput={(e) => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />
          {!running && (
            <button onClick={handleSend} disabled={!input.trim()}
              className="shrink-0 px-5 py-2 rounded-md text-xs font-medium transition-all disabled:opacity-30"
              style={{ background: 'var(--ibm-primary)', color: '#fff' }}>
              Send
            </button>
          )}
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
    <div className="text-sm leading-relaxed" style={{ color: muted ? 'var(--ibm-text-secondary)' : 'var(--ibm-text-primary)' }}>
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
