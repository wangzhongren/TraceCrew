import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { streamAgentResponse, executeShellAndWait, classifyIntent, streamPlan, streamStep } from '../utils/agentStream';
import type { PlanData } from '../utils/agentStream';

interface Props {
  projectPath: string;
  onClose: () => void;
  onFileChanged?: () => void;
}

type RunPhase = 'idle' | 'thinking' | 'installing' | 'building' | 'running' | 'fixing' | 'success' | 'failed';

const PHASE_LABELS: Record<RunPhase, string> = {
  idle: '就绪', thinking: '思考中...', installing: '安装依赖',
  building: '构建中', running: '运行中', fixing: '修复中',
  success: '完成', failed: '失败',
};

function ansiToHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\x1b\[0m/g, '</span>')
    .replace(/\x1b\[1m/g, '<span style="font-weight:bold">')
    .replace(/\x1b\[31m/g, '<span style="color:#f85149">')
    .replace(/\x1b\[32m/g, '<span style="color:#3fb950">')
    .replace(/\x1b\[33m/g, '<span style="color:#d29922">')
    .replace(/\x1b\[34m/g, '<span style="color:#58a6ff">')
    .replace(/\x1b\[35m/g, '<span style="color:#a371f7">')
    .replace(/\x1b\[36m/g, '<span style="color:#8ab4f8">')
    .replace(/\x1b\[37m/g, '<span style="color:#c9d1d9">')
    .replace(/\x1b\[90m/g, '<span style="color:#555">');
}

function formatInline(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="md-link">$1</a>');
}

function MarkdownRenderer({ text }: { text: string }) {
  const blocks = useMemo(() => {
    const result: Array<{ type: string; content: string; lang?: string }> = [];
    let remaining = text;
    while (remaining.length > 0) {
      const codeMatch = remaining.match(/^```(\w*)\n([\s\S]*?)\n```/);
      const headerMatch = remaining.match(/^(#{1,3})\s+(.+)/m);
      const firstMatch = [codeMatch, headerMatch].filter(Boolean).sort((a, b) => (a!.index || 0) - (b!.index || 0))[0];
      if (!firstMatch || (firstMatch.index && firstMatch.index > 0)) {
        const endIdx = firstMatch?.index ?? remaining.length;
        const para = remaining.slice(0, endIdx).trim();
        if (para) result.push({ type: 'paragraph', content: para });
        remaining = remaining.slice(endIdx); continue;
      }
      if (firstMatch === codeMatch && codeMatch!.index === 0) {
        result.push({ type: 'code', lang: codeMatch![1] || undefined, content: codeMatch![2].trimEnd() });
        remaining = remaining.slice(codeMatch![0].length);
      } else if (firstMatch === headerMatch && headerMatch!.index === 0) {
        result.push({ type: 'header', content: headerMatch![2], lang: String(headerMatch![1].length) });
        remaining = remaining.slice(headerMatch![0].length);
      } else break;
    }
    return result;
  }, [text]);
  if (blocks.length === 0) return <span className="whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: formatInline(text) }} />;
  return (<div className="space-y-1">{blocks.map((block, i) => {
    switch (block.type) {
      case 'code': return (<div key={i} className="rounded-lg overflow-hidden border" style={{ borderColor: 'var(--color-border-default)', background: '#0d1117' }}>{block.lang && <div className="px-3 py-1 border-b text-caption font-medium uppercase" style={{ borderColor: 'var(--color-border-subtle)', color: '#8b949e' }}>{block.lang}</div>}<pre className="px-3 py-2 text-xs leading-relaxed overflow-x-auto font-mono whitespace-pre" style={{ color: 'var(--color-text-secondary)' }}><code>{block.content}</code></pre></div>);
      case 'header': { const Tag = block.lang === '1' ? 'h2' as const : block.lang === '2' ? 'h3' as const : 'h4' as const; const sizes = { '1': 'text-md font-bold', '2': 'text-sm font-semibold', '3': 'text-xs font-medium' }; return <Tag key={i} className={sizes[block.lang as '1'|'2'|'3'] || sizes['3']} style={{ color: 'var(--color-text-primary)' }} dangerouslySetInnerHTML={{ __html: formatInline(block.content) }} />; }
      default: return <p key={i} className="text-sm leading-snug whitespace-pre-wrap break-words" style={{ color: 'var(--color-text-secondary)' }} dangerouslySetInnerHTML={{ __html: formatInline(block.content) }} />;
    }
  })}</div>);
}

interface ChatMsg { role: 'user' | 'agent'; content: string; reasoning?: string; }

export default function RunPage({ projectPath, onClose, onFileChanged }: Props) {
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [log, setLog] = useState('');
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [shellCount, setShellCount] = useState(0);
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [planThinking, setPlanThinking] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const historyRef = useRef<Array<{ role: string; content: string }>>([]);

  const appendLog = useCallback((text: string) => setLog((prev) => prev + text), []);
  const appendCmd = useCallback((cmd: string) => {
    setLog((prev) => (prev ? prev + `\n` : '') + `\x1b[36m❯\x1b[0m \x1b[1m${cmd}\x1b[0m\n`);
  }, []);
  const appendCmdOutput = useCallback((text: string) => setLog((prev) => prev + text), []);
  const appendCmdExit = useCallback((code: number) => {
    const color = code === 0 ? '\x1b[32m' : '\x1b[31m';
    setLog((prev) => prev + `\n${color}[exit ${code}]\x1b[0m`);
  }, []);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }); }, [log]);
  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' }); }, [chatMsgs]);

  const addChatMsg = useCallback((role: 'user' | 'agent', content: string) => {
    setChatMsgs((prev) => [...prev, { role, content }]);
  }, []);
  const appendAgentMsg = useCallback((text: string, reasoning?: string) => {
    setChatMsgs((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === 'agent') return [...prev.slice(0, -1), { role: 'agent', content: text, reasoning: reasoning || last.reasoning }];
      return [...prev, { role: 'agent', content: text, reasoning }];
    });
  }, []);

  // ── Plan execution ──
  const executePlan = useCallback(async () => {
    if (!plan || !plan.steps.length) return;
    setRunning(true);
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    try {
      for (let i = 0; i < plan.steps.length; i++) {
        if (signal.aborted) break;
        const step = plan.steps[i];
        setPhase('thinking');
        addChatMsg('agent', `🔄 **Step ${step.id}**: ${step.title}`);

        const result = await streamStep(step.description, step.id, signal, () => {});

        // Execute operations returned by sub-agent
        for (const op of result.operations || []) {
          try {
            let fp = op.file || '';
            if (fp && !/^(?:\/|[a-zA-Z]:[\\/])/.test(fp)) fp = projectPath.replace(/\\/g, '/') + '/' + fp.replace(/^[\\/]+/, '');
            switch (op.type) {
              case 'read_file': await window.codeatlas.file.readFile(fp, op.start_line, op.end_line); break;
              case 'list_dir': await window.codeatlas.file.listDirectory(fp || '.'); break;
              case 'insert_lines': await window.codeatlas.file.insertLines(fp, op.after_line || 0, op.content || ''); break;
              case 'replace_lines': await window.codeatlas.file.replaceLines(fp, op.start_line || 1, op.end_line || 1, op.content || ''); break;
              case 'delete_lines': await window.codeatlas.file.deleteLines(fp, op.start_line || 1, op.end_line || 1); break;
              case 'create_file': await window.codeatlas.file.writeFile(fp, op.content || ''); break;
              case 'delete_file': await window.codeatlas.file.deleteFile(fp); break;
              case 'run_shell': {
                const cmd = (op.content || '').trim();
                if (!cmd) break;
                appendCmd(cmd);
                const { exitCode } = await executeShellAndWait(cmd, (d) => appendCmdOutput(d), 120000);
                setShellCount((n) => n + 1);
                appendCmdExit(exitCode);
                break;
              }
            }
          } catch (_e) { /* continue */ }
        }
        addChatMsg('agent', `✅ **Step ${step.id} 完成**: ${result.message}`);
      }
      addChatMsg('agent', '✅ **所有步骤执行完毕**');
      setPlan(null);
      setPhase('success');
    } catch (e: any) {
      if (e.name !== 'AbortError') { setPhase('failed'); addChatMsg('agent', `❌ 执行出错: ${e.message}`); }
    } finally {
      setRunning(false);
      abortRef.current = null;
      onFileChanged?.();
    }
  }, [plan, projectPath, addChatMsg, appendCmd, appendCmdOutput, appendCmdExit, onFileChanged]);

  // ── Send handler ──
  const handleSend = useCallback(async () => {
    const msg = input.trim();
    if (!msg || running) return;
    setInput('');
    addChatMsg('user', msg);
    setRunning(true);
    setPhase('thinking');
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    try {
      const intent = await classifyIntent(msg);

      if (intent === 'execute') {
        // ── Plan mode ──
        setPlanThinking('');
        setPlan(null);
        setPhase('thinking');
        addChatMsg('agent', '🔍 正在分析项目并制定计划...');

        const planData = await streamPlan(msg, signal, (t) => setPlanThinking((prev) => prev + t));

        if (!planData.steps || planData.steps.length === 0) {
          appendAgentMsg('无法生成执行计划，请重新描述需求。');
          setPhase('idle');
          setRunning(false);
          return;
        }

        setPlan(planData);
        setPlanThinking('');
        const planText = `📋 **${planData.plan || '执行计划'}**\n\n${planData.steps.map((s) => `**${s.id}.** ${s.title}\n> ${s.description}`).join('\n\n')}`;
        appendAgentMsg(planText);
        setPhase('idle');
        setRunning(false);
      } else {
        // ── Normal chat mode ──
        // Backend handles tool execution internally — frontend just displays
        const body: Record<string, any> = { history: [...historyRef.current, { role: 'user', content: msg }] };
        const { message, reasoning } = await streamAgentResponse(body, signal, () => {}, undefined);
        appendAgentMsg(message, reasoning);
        historyRef.current = [...historyRef.current, { role: 'user', content: msg }, { role: 'agent', content: message }];
        setPhase('success');
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') { setLog((prev) => prev + `\n\n\x1b[31mError: ${e.message}\x1b[0m`); setPhase('failed'); }
    } finally {
      setRunning(false);
      abortRef.current = null;
      onFileChanged?.();
    }
  }, [input, running, projectPath, addChatMsg, appendAgentMsg, appendCmd, appendCmdOutput, appendCmdExit, appendLog, onFileChanged, shellCount]);

  const statusColor = phase === 'success' ? '#3fb950' : phase === 'failed' || phase === 'fixing' ? '#f85149' : phase === 'idle' ? '#8b949e' : '#8ab4f8';

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#0c0c0c' }}>
      <div className="flex items-center justify-between h-9 shrink-0 px-4 border-b select-none" style={{ borderColor: '#2d2d2d', background: '#161616' }}>
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium tracking-wide" style={{ color: '#cccccc' }}>AI 终端</span>
          <span className="text-caption" style={{ color: '#666666' }}>{projectPath.split(/[\\/]/).pop()}</span>
          <span className="text-caption flex items-center gap-1.5" style={{ color: statusColor }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor, animation: running ? 'pulse 1.5s infinite' : undefined }} />{PHASE_LABELS[phase]}
          </span>
        </div>
        <button onClick={running ? () => { abortRef.current?.abort(); setRunning(false); } : onClose} className="px-3 py-0.5 rounded text-xs transition-colors hover:bg-white/5" style={{ color: '#888888' }}>{running ? '停止' : '×'}</button>
      </div>
      <div className="flex-1 flex overflow-hidden">
        {/* Terminal */}
        <div className="flex-1 flex flex-col" style={{ background: '#0c0c0c' }}>
          <div className="px-3 py-1 flex items-center gap-3 shrink-0 border-b" style={{ borderColor: '#1e1e1e', background: '#111111' }}>
            <span className="text-caption font-medium tracking-wide" style={{ color: '#888888' }}>TERMINAL</span>
            <span className="text-caption px-2 py-0.5 rounded" style={{ background: '#1a3350', color: '#8ab4f8' }}>bash</span>
          </div>
          <div ref={logRef} className="flex-1 overflow-y-auto p-4 font-mono text-body leading-relaxed" style={{ color: 'var(--color-text-secondary)', background: '#0c0c0c' }}>
            {log ? <div className="whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: ansiToHtml(log) }} /> : (
              <div style={{ color: '#555555' }}>
                <div className="mb-1">Last login: {new Date().toLocaleString()} on ttys001</div>
                <div className="mb-3"><span style={{ color: '#3fb950' }}>●</span> <span style={{ color: '#8ab4f8' }}>~/{(projectPath.split(/[\\/]/).pop() || 'project')}</span> on <span style={{ color: '#a371f7' }}>main</span></div>
                <div className="flex items-center gap-1"><span style={{ color: '#3fb950' }}>❯</span><span className="animate-pulse" style={{ color: '#555555' }}>在右边输入指令</span></div>
              </div>
            )}
          </div>
        </div>
        {/* Chat */}
        <div className="w-[420px] shrink-0 flex flex-col border-l" style={{ borderColor: '#1e1e1e', background: '#0d0d0d' }}>
          {/* Chat header */}
          <div className="px-4 py-2.5 border-b flex items-center gap-2 shrink-0" style={{ borderColor: '#1e1e1e', background: '#111111' }}>
            <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #1a3350, #1a4a6e)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8ab4f8" strokeWidth="2"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/><path d="M8 12h8M12 8v8"/></svg>
            </div>
            <span className="text-xs font-medium" style={{ color: '#cccccc' }}>AI 助手</span>
            {running && <span className="w-1.5 h-1.5 rounded-full animate-pulse ml-auto" style={{ background: '#3fb950' }} />}
          </div>

          {/* Messages */}
          <div ref={chatRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {planThinking && (
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center mt-0.5" style={{ background: '#1a3350' }}>
                  <span className="text-caption" style={{ color: '#8ab4f8' }}>AI</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed" style={{ background: '#161616', color: '#888888' }}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="flex gap-1">
                        <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: '#8ab4f8', animationDelay: '0ms' }} />
                        <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: '#8ab4f8', animationDelay: '150ms' }} />
                        <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: '#8ab4f8', animationDelay: '300ms' }} />
                      </span>
                      <span className="text-caption" style={{ color: '#555' }}>分析项目中...</span>
                    </div>
                    <div className="text-caption leading-relaxed whitespace-pre-wrap opacity-60">{planThinking.slice(-200)}</div>
                  </div>
                </div>
              </div>
            )}

            {chatMsgs.length === 0 && !planThinking && (
              <div className="flex flex-col items-center justify-center h-full py-12">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, #1a3350, #1a4a6e)' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8ab4f8" strokeWidth="1.5"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/><path d="M8 12h8M12 8v8"/></svg>
                </div>
                <div className="text-body font-medium mb-1" style={{ color: '#aaaaaa' }}>AI 终端助手</div>
                <div className="text-xs leading-relaxed text-center" style={{ color: '#555555' }}>
                  告诉我你想做什么<br />我来规划并执行
                </div>
              </div>
            )}

            {chatMsgs.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center mt-0.5 ${msg.role === 'user' ? '' : ''}`}
                  style={msg.role === 'user' ? { background: '#1a3350' } : { background: '#12261a' }}>
                  <span className="text-caption font-medium" style={msg.role === 'user' ? { color: '#8ab4f8' } : { color: '#3fb950' }}>
                    {msg.role === 'user' ? '你' : 'AI'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="rounded-2xl px-4 py-3 text-sm leading-relaxed"
                    style={msg.role === 'user'
                      ? { background: '#1a3350', color: 'var(--color-text-secondary)', borderTopRightRadius: '4px' }
                      : { background: '#161616', color: '#d4d4d4', borderTopLeftRadius: '4px' }}>
                    {msg.role === 'agent' && msg.reasoning && (
                      <details className="mb-2">
                        <summary className="text-caption cursor-pointer select-none hover:opacity-80" style={{ color: '#666' }}>思考过程</summary>
                        <div className="mt-2 text-caption leading-relaxed whitespace-pre-wrap border-l-2 pl-3 py-1" style={{ color: '#777', borderColor: '#2a2a2a' }}>{msg.reasoning}</div>
                      </details>
                    )}
                    <MarkdownRenderer text={msg.content} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Plan actions */}
          {plan && !running && (
            <div className="px-4 py-3 border-t shrink-0 space-y-2" style={{ borderColor: '#1e1e1e', background: '#111111' }}>
              <div className="text-caption font-medium mb-1" style={{ color: '#888' }}>📋 {plan.steps.length} 个步骤，确认后开始执行</div>
              <div className="flex gap-2">
                <button onClick={executePlan}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium transition-all hover:opacity-90 active:scale-[0.98] flex items-center justify-center gap-2"
                  style={{ background: 'linear-gradient(135deg, #1a6e3a, #1a8a4a)', color: '#fff' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
                  开始执行
                </button>
                <button onClick={() => setPlan(null)}
                  className="px-4 py-2.5 rounded-xl text-sm transition-all hover:bg-white/5"
                  style={{ background: '#1e1e1e', color: '#888' }}>取消</button>
              </div>
            </div>
          )}

          {/* Input */}
          {!plan && (
            <div className="p-4 border-t shrink-0" style={{ borderColor: '#1e1e1e' }}>
              <div className="flex gap-2 items-end">
                <textarea
                  ref={inputRef as any}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder="输入你想做的事..."
                  disabled={running}
                  rows={1}
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm outline-none border resize-none"
                  style={{ background: '#161616', color: 'var(--color-text-secondary)', borderColor: '#2a2a2a', opacity: running ? 0.5 : 1, maxHeight: '80px' }}
                />
                <button onClick={handleSend} disabled={running || !input.trim()}
                  className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-[0.95]"
                  style={{ background: running || !input.trim() ? '#1a1a1a' : '#1a3350', opacity: running || !input.trim() ? 0.5 : 1 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={running || !input.trim() ? '#555' : '#8ab4f8'} strokeWidth="2">
                    <path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
    </div>
  );
}