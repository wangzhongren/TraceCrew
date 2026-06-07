import { useState, useRef, useEffect } from 'react';
import type { PipelineState } from '../App';
import type { CallGraph } from './MapCanvas';

const AG: Record<string, { name: string; color: string; bg: string }> = {
  planner:  { name: 'Planner',  color: '#78a9ff', bg: '#061832' },
  mapper:   { name: 'Mapper',   color: '#a78bfa', bg: '#0f0720' },
  executor: { name: 'Executor', color: '#6fdc8c', bg: '#071a10' },
  reviewer: { name: 'Reviewer', color: '#ffb3b8', bg: '#2a0a0a' },
  user:     { name: 'You',      color: '#a8a8a8', bg: 'transparent' },
  system:   { name: 'System',   color: '#6f6f6f', bg: 'transparent' },
};

export default function ChatPanel({ projectPath, onPipelineChange }: {
  projectPath: string | null;
  onPipelineChange: (s: PipelineState) => void;
}) {
  const [messages, setMessages] = useState<Array<{
    agent: string; content: string; plan?: any; graph?: CallGraph;
  }>>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const historyRef = useRef<Array<{ role: string; content: string }>>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  /* ── Stream helper ── */
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
    const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[1] || m[0]); } catch { return null; }
  };

  /* ── Execute operations (read, write, shell) ── */
  const execOps = async (ops: any[]): Promise<string> => {
    let ctx = '';
    for (const op of ops) {
      try {
        let fp = op.file || '';
        if (fp && !/^[a-zA-Z]:[\\/]/.test(fp) && projectPath) {
          fp = projectPath.replace(/\\/g, '/') + '/' + fp.replace(/^[\\/]+/, '');
        }
        if (!fp && op.type !== 'run_shell') continue;

        switch (op.type) {
          case 'read_file': {
            const fc = await window.codeatlas.file.readFile(fp, op.start_line, op.end_line);
            ctx += `\n\n=== ${op.file || fp} ===\n${fc.content}\n`;
            break;
          }
          case 'list_dir': {
            const entries = await window.codeatlas.file.listDirectory(fp);
            ctx += `\n\n=== 目录: ${op.file} ===\n${JSON.stringify(entries, null, 2)}\n`;
            break;
          }
          case 'insert_lines':
            await window.codeatlas.file.insertLines(fp, op.after_line || 0, op.content || '');
            break;
          case 'replace_lines':
            await window.codeatlas.file.replaceLines(fp, op.start_line || 1, op.end_line || 1, op.content || '');
            break;
          case 'delete_lines':
            await window.codeatlas.file.deleteLines(fp, op.start_line || 1, op.end_line || 1);
            break;
          case 'create_file':
            await window.codeatlas.file.writeFile(fp, op.content || '');
            break;
          case 'run_shell': {
            const cmd = op.content || '';
            if (!cmd) break;
            ctx += await new Promise<string>((resolve) => {
              const sid = window.codeatlas.shell.run(cmd);
              let out = '';
              window.codeatlas.shell.onData((id, d) => { if (id === sid) out += d; });
              window.codeatlas.shell.onDone((id, code) => {
                if (id === sid) resolve(`\n\n=== 命令: ${cmd} (exit ${code}) ===\n${out}\n`);
              });
              setTimeout(() => resolve(`\n[命令超时: ${cmd}]\n`), 15000);
            });
            break;
          }
        }
      } catch (e: any) {
        ctx += `\n[操作失败: ${op.type} ${op.file} — ${e.message}]\n`;
      }
    }
    return ctx;
  };

  /* ── Agent loop ── */
  const agentLoop = async (
    systemPrompt: string,
    initialCtx: string,
    onToken: (t: string) => void,
    shouldStop: (text: string, ops: any[]) => boolean,
    allowWrite: boolean,
    history?: Array<{ role: string; content: string }>,
  ): Promise<string> => {
    let fullText = '';
    let body: Record<string, any> = {
      instruction: `${initialCtx}\n\n${systemPrompt}`,
      file_tree: null, history: history || [],
    };
    try { body.file_tree = await window.codeatlas.file.listDirectory(projectPath!); } catch {}

    for (let round = 0; round < 12; round++) {
      const { text, ops } = await streamWithOps(body, onToken);
      fullText += text;

      if (shouldStop(fullText, ops)) break;

      const readOps = ops.filter((o: any) =>
        allowWrite
          ? true
          : ['read_file', 'list_dir', 'search'].includes(o.type),
      );
      if (readOps.length === 0) break;

      const ctx = await execOps(readOps);
      if (!ctx && !allowWrite) break;

      body = {
        instruction: allowWrite ? `继续执行：\n${ctx}` : `读取的文件内容如下，请继续分析：\n${ctx}`,
        file_tree: body.file_tree, history: history || [],
      };
    }
    return fullText;
  };

  /* ════ Planner — only plans, no drawing ════ */
  const runPlanner = async (instruction: string) => {
    if (!projectPath) return;
    setRunning(true);
    abortRef.current = new AbortController();
    const projName = projectPath.split(/[\\/]/).pop() || '';

    // Add user message to history
    const hist = [...historyRef.current, { role: 'user', content: instruction }];

    onPipelineChange({ phase: 'planning', graph: null });
    setMessages((prev) => [...prev, { agent: 'planner', content: '' }]);

    const systemPrompt = `【角色: Planner / 架构规划师】
你的职责是理解用户需求，读取代码，制定执行计划。
不要画图，不要生成 call_graph。只输出计划。

你可以读取文件、浏览目录来理解项目结构。

输出 JSON:
\`\`\`json
{
  "plan_summary": "计划概述",
  "needs_execution": true/false,
  "steps": [
    {"id": 1, "title": "...", "description": "具体操作(改哪个文件,怎么改)", "deps": []}
  ],
  "key_files": ["涉及的关键文件路径"],
  "notes": "给 Mapper 的备注——哪些调用关系需要在图中展示"
}
\`\`\`
不需要执行时 needs_execution 为 false。`;

    const initialCtx = `【当前项目: ${projName}，路径: ${projectPath}】\n\n用户需求: ${instruction}\n\n请先读取关键文件了解项目结构。`;

    const fullText = await agentLoop(
      systemPrompt, initialCtx,
      (t) => { setMessages((prev) => { const u = [...prev]; const l = u[u.length - 1]; u[u.length - 1] = { ...l, content: (l.content || '') + t }; return u; }); },
      (text) => !!(parseJson(text)?.plan_summary),
      false, hist,
    );

    const plan = parseJson(fullText);
    // History: user + planner summary
    hist.push({ role: 'assistant', content: `[Plan] ${plan?.plan_summary || fullText.slice(0, 300)}` });
    historyRef.current = hist;
    setMessages((prev) => { const u = [...prev]; const l = u[u.length - 1]; u[u.length - 1] = { ...l, plan }; return u; });

    if (plan?.needs_execution && plan.steps?.length > 0) {
      // → Mapper draws the call graph
      await runMapper(instruction, plan);
    } else {
      onPipelineChange({ phase: 'done', graph: null });
      setRunning(false);
    }
  };

  /* ════ Mapper — reads plan, draws call graph ════ */
  const runMapper = async (instruction: string, plan: any) => {
    onPipelineChange({ phase: 'planning', graph: null });
    setMessages((prev) => [...prev, { agent: 'mapper', content: '' }]);

    const systemPrompt = `【角色: Mapper / 调用链路绘制者】
你的职责是根据 Planner 的计划，读取相关代码文件，绘制调用链路图。

图中需要展示:
1. 当前代码的调用关系（谁调谁）
2. 问题所在节点（status: "problem"）
3. 计划修改的节点（status: "planned_change"）
4. 计划新增的节点（status: "planned_new"）

输出 JSON（只输出这个，不需要 plan_summary 和 steps）:
\`\`\`json
{
  "call_graph": {
    "nodes": [
      {"id": "router", "label": "main.ts", "kind": "file", "status": "existing", "detail": "路由入口", "file": "src/main.ts"},
      {"id": "auth.login", "label": "handleLogin", "kind": "function", "status": "problem", "detail": "空token绕过认证", "file": "src/auth.ts", "line": 42},
      {"id": "db.find", "label": "findUser", "kind": "function", "status": "existing", "detail": "数据库查询", "file": "src/db.ts"}
    ],
    "edges": [
      {"from": "router", "to": "auth.login", "label": "calls", "status": "existing"},
      {"from": "auth.login", "to": "db.find", "label": "calls", "status": "existing"}
    ]
  }
}
\`\`\`
status: "existing" | "problem" | "planned_change" | "planned_new"
kind: "file" | "function" | "class" | "module" | "endpoint"`;

    const notes = plan.notes || '';
    const keyFiles = (plan.key_files || []).join(', ');
    const initialCtx = `【用户需求】${instruction}\n【Planner 计划】${plan.plan_summary}\n【关键文件】${keyFiles}\n【备注】${notes}\n\n请读取相关代码，绘制调用链路图。`;

    const fullText = await agentLoop(
      systemPrompt, initialCtx,
      (t) => { setMessages((prev) => { const u = [...prev]; const l = u[u.length - 1]; u[u.length - 1] = { ...l, content: (l.content || '') + t }; return u; }); },
      (text) => !!(parseJson(text)?.call_graph),
      false, // read-only
    );

    const data = parseJson(fullText);
    if (data?.call_graph?.nodes?.length > 0) {
      const graph: CallGraph = { nodes: data.call_graph.nodes, edges: data.call_graph.edges || [] };
      setMessages((prev) => { const u = [...prev]; const l = u[u.length - 1]; u[u.length - 1] = { ...l, graph }; return u; });
      onPipelineChange({ phase: 'planning', graph });

      // → Executor
      await runExecutor(instruction, plan, graph);
    } else {
      onPipelineChange({ phase: 'done', graph: null });
      setRunning(false);
    }
  };

  /* ════ Executor ════ */
  const runExecutor = async (instruction: string, plan: any, graph: CallGraph) => {
    onPipelineChange({ phase: 'executing', graph });
    setMessages((prev) => [...prev, { agent: 'executor', content: '' }]);

    const stepsText = (plan.steps || []).map((s: any) => `[${s.id}] ${s.title}: ${s.description}`).join('\n');
    const systemPrompt = `【角色: Executor】
按计划执行。读文件、改代码、运行命令。完成后输出更新后的 call_graph（节点 status 改为 "done"）。`;
    const initialCtx = `【用户需求】${instruction}\n【计划】\n${stepsText}\n\n请开始执行。`;

    const fullText = await agentLoop(
      systemPrompt, initialCtx,
      (t) => { setMessages((prev) => { const u = [...prev]; const l = u[u.length - 1]; u[u.length - 1] = { ...l, content: (l.content || '') + t }; return u; }); },
      () => false,
      true, // allow write + shell
    );

    const execData = parseJson(fullText);
    const updatedGraph = execData?.call_graph
      ? { nodes: execData.call_graph.nodes.map((n: any) => n.status === 'planned_change' || n.status === 'planned_new' ? { ...n, status: 'done' } : n), edges: execData.call_graph.edges || [] }
      : { ...graph, nodes: graph.nodes.map((n: any) => n.status === 'planned_change' || n.status === 'planned_new' ? { ...n, status: 'done' } : n) };

    onPipelineChange({ phase: 'executing', graph: updatedGraph });
    await runReviewer(instruction, plan, fullText, updatedGraph);
  };

  /* ════ Reviewer ════ */
  const runReviewer = async (instruction: string, plan: any, execText: string, graph: CallGraph) => {
    onPipelineChange({ phase: 'reviewing', graph });
    setMessages((prev) => [...prev, { agent: 'reviewer', content: '' }]);

    const systemPrompt = `【角色: Reviewer】
审查执行结果。读取被修改的文件确认改动正确：
\`\`\`json
{"passed": true/false, "feedback": "意见", "issues": ["问题"]}
\`\`\``;
    const initialCtx = `【用户需求】${instruction}\n【计划】${JSON.stringify(plan.steps || [])}\n【执行输出】${execText.slice(-3000)}\n\n请审查。`;

    let fullText = '';
    await agentLoop(
      systemPrompt, initialCtx,
      (t) => { fullText += t; setMessages((prev) => { const u = [...prev]; const l = u[u.length - 1]; u[u.length - 1] = { ...l, content: (l.content || '') + t }; return u; }); },
      (text) => !!(parseJson(text)?.passed !== undefined),
      false,
    );

    const review = parseJson(fullText);
    if (review?.passed) {
      onPipelineChange({ phase: 'done', graph });
      setMessages((prev) => [...prev, { agent: 'system', content: '✓ Review passed.' }]);
      historyRef.current.push({ role: 'assistant', content: `✓ Review passed. ${review.feedback || ''}` });
    } else {
      onPipelineChange({ phase: 'rejected', graph });
      setMessages((prev) => [...prev, {
        agent: 'system',
        content: `✗ Rejected.\n${(review?.issues || []).map((i: string) => '• ' + i).join('\n')}`,
      }]);
      historyRef.current.push({ role: 'assistant', content: `✗ Review rejected: ${(review?.issues || []).join('; ')}` });
    }
    setRunning(false);
  };

  /* ════ UI ════ */
  const handleSend = () => {
    if (!input.trim() || running) return;
    const instruction = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { agent: 'user', content: instruction }]);
    runPlanner(instruction);
  };

  return (
    <div className="flex flex-col h-full">
      <header className="shrink-0 px-4 py-3 border-b" style={{ borderColor: 'var(--ibm-border-subtle)' }}>
        <h2 className="text-sm font-medium" style={{ color: 'var(--ibm-text)' }}>Agent Pipeline</h2>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--ibm-text-placeholder)' }}>
          Planner → Mapper → Executor → Reviewer
        </p>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-2" style={{ color: 'var(--ibm-text-placeholder)' }}>
              <div className="text-sm font-light">Describe your task</div>
              <div className="text-xs">Planner plans · Mapper draws · Executor runs · Reviewer checks</div>
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          const cfg = AG[msg.agent] || AG.system;
          return (
            <div key={i} className="animate-fade-in">
              <div className="flex items-center gap-2 mt-3 mb-1">
                <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: cfg.color }}>{cfg.name}</span>
              </div>
              {msg.plan && (
                <div className="mb-2 p-2 rounded-lg border text-xs" style={{ borderColor: 'var(--ibm-border-subtle)', background: 'var(--ibm-bg)', color: 'var(--ibm-text-secondary)' }}>
                  <div className="font-medium" style={{ color: '#78a9ff' }}>Plan: {msg.plan.plan_summary}</div>
                  {(msg.plan.steps || []).map((s: any) => (
                    <div key={s.id} className="mt-1">  {s.id}. {s.title} — {s.description}</div>
                  ))}
                </div>
              )}
              {msg.content && (
                <div className="text-sm leading-relaxed whitespace-pre-wrap break-words"
                  style={{ color: msg.agent === 'system' ? 'var(--ibm-text-secondary)' : 'var(--ibm-text)' }}>
                  {msg.content}
                </div>
              )}
              {msg.graph && (
                <div className="mt-1 text-[10px]" style={{ color: 'var(--ibm-text-placeholder)' }}>
                  📊 {msg.graph.nodes.length} nodes, {msg.graph.edges.length} edges
                </div>
              )}
            </div>
          );
        })}
      </div>

      <footer className="shrink-0 p-3 border-t" style={{ borderColor: 'var(--ibm-border-subtle)' }}>
        <div className="flex gap-2">
          {running && (
            <button onClick={() => { abortRef.current?.abort(); setRunning(false); }}
              className="px-3 py-2 rounded-md text-xs font-medium shrink-0"
              style={{ background: 'var(--ibm-layer-accent)', color: 'var(--ibm-error)' }}>Stop</button>
          )}
          <textarea value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="Describe what you want..."
            disabled={running} rows={1}
            className="flex-1 px-3 py-2 text-sm bg-transparent outline-none resize-none rounded-md"
            style={{ border: '1px solid var(--ibm-border)', color: 'var(--ibm-text)', background: 'var(--ibm-bg)', fontFamily: 'var(--ibm-font)' }}
            onInput={(e) => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          />
          {!running && (
            <button onClick={handleSend} disabled={!input.trim()}
              className="px-4 py-2 rounded-md text-xs font-medium transition-colors shrink-0 disabled:opacity-40"
              style={{ background: 'var(--ibm-primary)', color: '#fff' }}>Send</button>
          )}
        </div>
      </footer>
    </div>
  );
}
