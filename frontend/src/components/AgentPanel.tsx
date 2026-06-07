import { useState, useRef, useEffect, useMemo } from 'react';
import type { FileContent } from '../types/electron.d';
import type { CodeSelection } from './CodeViewer';
import { streamAgentResponse, streamPlan, streamStep } from '../utils/agentStream';
import type { PlanData } from '../utils/agentStream';
import { languageInstruction, tr, type Language } from '../i18n';

interface Props {
  projectPath: string | null;
  openFilePath: string | null;
  selection: CodeSelection | null;
  onClearSelection: () => void;
  injectContext?: string;
  onConsumeContext?: () => void;
  onFileChanged?: () => void;
  language: Language;
}

interface OperationStep {
  type: string; file: string; start_line?: number; end_line?: number;
  after_line?: number; content?: string; pending?: boolean; done?: boolean;
}

interface Message {
  role: 'user' | 'agent';
  content: string;
  operations?: OperationStep[];
  steps?: Array<{ text: string; icon: string; done: boolean; backupId?: string; content?: string }>;
}

interface MapSearchResult {
  features?: Array<{ id: string; label: string; level: number; description?: string; flow_description?: string; files?: string[]; functions?: string[] }>;
  symbols?: Array<{ name: string; kind: string; file: string; line: number; preview?: string }>;
}

function formatMapContext(result: MapSearchResult, language: Language): string {
  const features = result.features || [];
  const symbols = result.symbols || [];
  if (features.length === 0 && symbols.length === 0) return '';
  const lines = [language === 'zh' ? '【项目地图查询结果】' : '[Project map search results]'];
  if (features.length > 0) {
    lines.push(language === 'zh' ? '相关地图节点:' : 'Relevant map nodes:');
    for (const feature of features.slice(0, 5)) {
      lines.push(`- ${feature.label} (${feature.id}, level ${feature.level})`);
      if (feature.description) lines.push(`  ${language === 'zh' ? '描述' : 'Description'}: ${feature.description}`);
      if (feature.files?.length) lines.push(`  ${language === 'zh' ? '文件' : 'Files'}: ${feature.files.slice(0, 5).join(', ')}`);
    }
  }
  if (symbols.length > 0) {
    lines.push(language === 'zh' ? '真实代码符号:' : 'Real code symbols:');
    for (const symbol of symbols.slice(0, 8)) {
      lines.push(`- ${symbol.kind} ${symbol.name} at ${symbol.file}:${symbol.line}${symbol.preview ? ` — ${symbol.preview}` : ''}`);
    }
  }
  return lines.join('\n');
}

/* ── Markdown Renderer ── */
function formatInline(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="md-link">$1</a>');
}

function MarkdownRenderer({ text }: { text: string }) {
  const blocks = useMemo(() => {
    const result: Array<{ type: string; content: string; lang?: string }> = [];
    let remaining = text;
    while (remaining.length > 0) {
      const codeMatch = remaining.match(/^```(\w*)\n([\s\S]*?)```/m);
      const headerMatch = remaining.match(/^(#{1,3})\s+(.+)/m);
      const ulMatch = remaining.match(/^- (.+)/m);
      const olMatch = remaining.match(/^\d+\. (.+)/m);
      const bqMatch = remaining.match(/^> (.+)/m);
      const hrMatch = remaining.match(/^---/m);
      const firstMatch = [codeMatch, headerMatch, ulMatch, olMatch, bqMatch, hrMatch].filter(Boolean).sort((a, b) => (a!.index || 0) - (b!.index || 0))[0];
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
      } else if (firstMatch === ulMatch && ulMatch!.index === 0) {
        result.push({ type: 'list-item', content: ulMatch![1] });
        remaining = remaining.slice(ulMatch![0].length);
      } else if (firstMatch === olMatch && olMatch!.index === 0) {
        result.push({ type: 'list-item', content: olMatch![1] });
        remaining = remaining.slice(olMatch![0].length);
      } else if (firstMatch === bqMatch && bqMatch!.index === 0) {
        result.push({ type: 'blockquote', content: bqMatch![1] });
        remaining = remaining.slice(bqMatch![0].length);
      } else if (firstMatch === hrMatch && hrMatch!.index === 0) {
        result.push({ type: 'hr', content: '' });
        remaining = remaining.slice(hrMatch![0].length);
      } else break;
    }
    return result;
  }, [text]);

  if (blocks.length === 0) return <span className="whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: formatInline(text) }} />;

  return (
    <div className="space-y-2">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'code': return (
            <div key={i} className="rounded-lg overflow-hidden border" style={{ borderColor: '#2a2a2a', background: '#0a0a0a' }}>
              {block.lang && <div className="px-3 py-1.5 border-b text-[10px] font-medium uppercase tracking-wider" style={{ borderColor: '#1f1f1f', color: '#666' }}>{block.lang}</div>}
              <pre className="px-4 py-3 text-[12px] leading-relaxed overflow-x-auto font-mono whitespace-pre" style={{ color: '#c9d1d9' }}><code>{block.content}</code></pre>
            </div>);
          case 'header': {
            const Tag = block.lang === '1' ? 'h2' as const : block.lang === '2' ? 'h3' as const : 'h4' as const;
            const sizes = { '1': 'text-[15px] font-bold tracking-tight', '2': 'text-[13px] font-semibold', '3': 'text-[12px] font-medium' };
            return <Tag key={i} className={`${sizes[block.lang as '1'|'2'|'3'] || sizes['3']} mt-3 first:mt-0`} style={{ color: '#e6e6e6' }} dangerouslySetInnerHTML={{ __html: formatInline(block.content) }} />;
          }
          case 'list-item': return <div key={i} className="flex gap-2 pl-1"><span className="text-[10px] mt-0.5 shrink-0" style={{ color: '#555' }}>•</span><span className="text-[13px]" style={{ color: '#c9d1d9' }} dangerouslySetInnerHTML={{ __html: formatInline(block.content) }} /></div>;
          case 'blockquote': return <div key={i} className="border-l-2 pl-3 py-1 text-[13px] italic" style={{ borderColor: '#2a2a2a', color: '#888' }} dangerouslySetInnerHTML={{ __html: formatInline(block.content) }} />;
          case 'hr': return <hr key={i} className="my-2" style={{ borderColor: '#1e1e1e' }} />;
          default: return <p key={i} className="text-[13px] leading-relaxed whitespace-pre-wrap break-words" style={{ color: '#c9d1d9' }} dangerouslySetInnerHTML={{ __html: formatInline(block.content) }} />;
        }
      })}
    </div>
  );
}

const OP_STYLE: Record<string, { icon: string; color: string; bg: string }> = {
  insert_lines: { icon: '+', color: '#3fb950', bg: '#12261a' },
  replace_lines: { icon: '~', color: '#d29922', bg: '#272115' },
  delete_lines: { icon: '−', color: '#f85149', bg: '#261212' },
  create_file: { icon: '+', color: '#3fb950', bg: '#12261a' },
  delete_file: { icon: '×', color: '#f85149', bg: '#261212' },
  list_dir: { icon: '📁', color: '#8b949e', bg: '#1c1c1c' },
  search: { icon: '🔍', color: '#8b949e', bg: '#1c1c1c' },
  read_file: { icon: '📄', color: '#8b949e', bg: '#1c1c1c' },
};

export default function AgentPanel({ projectPath, openFilePath, selection, onClearSelection, injectContext, onConsumeContext, onFileChanged, language }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [planThinking, setPlanThinking] = useState('');

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleStop = () => {
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    setSending(false);
  };

  const executePlan = async () => {
    if (!plan || !plan.steps.length || !projectPath) return;
    setSending(true);
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    setMessages((prev) => [...prev, { role: 'agent', content: '' }]);
    try {
      for (let i = 0; i < plan.steps.length; i++) {
        if (signal.aborted) break;
        const step = plan.steps[i];
        setMessages((prev) => { const u = [...prev]; const last = u[u.length - 1]; if (last?.role === 'agent') u[u.length - 1] = { ...last, content: last.content + `\n\n🔄 **Step ${step.id}**: ${step.title}...` }; return u; });
        const result = await streamStep(step.description, step.id, signal, () => {});
        for (const op of result.operations || []) {
          try {
            let fp = op.file || '';
            const isAbs = (p: string) => /^(?:\/|[a-zA-Z]:[\\/])/.test(p);
            if (fp && !isAbs(fp)) fp = projectPath.replace(/\\/g, '/') + '/' + fp.replace(/^[\\/]+/, '');
            switch (op.type) {
              case 'read_file': await window.codeatlas.file.readFile(fp, op.start_line, op.end_line); break;
              case 'list_dir': await window.codeatlas.file.listDirectory(fp || '.'); break;
              case 'insert_lines': await window.codeatlas.file.insertLines(fp, op.after_line || 0, op.content || ''); break;
              case 'replace_lines': await window.codeatlas.file.replaceLines(fp, op.start_line || 1, op.end_line || 1, op.content || ''); break;
              case 'delete_lines': await window.codeatlas.file.deleteLines(fp, op.start_line || 1, op.end_line || 1); break;
              case 'create_file': await window.codeatlas.file.writeFile(fp, op.content || ''); break;
              case 'delete_file': await window.codeatlas.file.deleteFile(fp); break;
            }
          } catch (_e) { /* */ }
        }
        setMessages((prev) => { const u = [...prev]; const last = u[u.length - 1]; if (last?.role === 'agent') u[u.length - 1] = { ...last, content: last.content + ' ✅' }; return u; });
      }
      setMessages((prev) => { const u = [...prev]; const last = u[u.length - 1]; if (last?.role === 'agent') u[u.length - 1] = { ...last, content: last.content + '\n\n✅ **所有步骤执行完毕**' }; return u; });
      setPlan(null);
      onFileChanged?.();
    } catch (e: any) {
      if (e.name !== 'AbortError') setMessages((prev) => [...prev, { role: 'agent', content: `❌ 执行出错: ${e.message}` }]);
    } finally { setSending(false); abortRef.current = null; }
  };

  const handleSend = async () => {
    let instruction = input.trim();
    if (!instruction || sending) return;
    setSending(true); setInput('');
    abortRef.current = new AbortController();
    if (injectContext) { instruction = `${instruction}\n\n---\n【来自地图的参考】\n${injectContext}`; onConsumeContext?.(); }
    setMessages((prev) => [...prev, { role: 'user', content: instruction }]);

    try {
      let openFileCtx = null;
      if (projectPath && openFilePath) {
        try { const fc: FileContent = await window.codeatlas.file.readFile(openFilePath); openFileCtx = { path: openFilePath.replace(projectPath, '').replace(/^[\\/]/, ''), content: fc.content, lines: fc.lineCount }; } catch { /* */ }
      }
      let mapContext = '';
      if (projectPath) {
        try {
          const params = new URLSearchParams({ project_path: projectPath, query: instruction, limit: '8' });
          const res = await fetch(`/api/v1/features/search?${params.toString()}`);
          if (res.ok) mapContext = formatMapContext(await res.json(), language);
        } catch (e) { console.warn('[Agent] map search failed:', e); }
      }

      let mode: 'execute' | 'readonly' = 'readonly';
      try {
        const ir = await fetch('/api/v1/agent/classify-intent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instruction }) });
        if (ir.ok) { const { intent } = await ir.json(); mode = intent === 'execute' ? 'execute' : 'readonly'; }
      } catch { /* */ }

      // ── Plan mode ──
      if (mode === 'execute' && projectPath) {
        setPlanThinking(''); setPlan(null);
        setMessages((prev) => [...prev, { role: 'agent', content: '' }]);
        try {
          const planData = await streamPlan(instruction, abortRef.current?.signal, (t) => setPlanThinking((prev) => prev + t));
          if (planData.steps?.length) {
            setPlan(planData); setPlanThinking('');
            const planText = `📋 **${planData.plan || '执行计划'}**\n\n${planData.steps.map((s) => `**${s.id}.** ${s.title}\n> ${s.description}`).join('\n\n')}`;
            setMessages((prev) => { const u = [...prev]; const last = u[u.length - 1]; if (last?.role === 'agent') u[u.length - 1] = { ...last, content: planText }; return u; });
          } else {
            setMessages((prev) => { const u = [...prev]; const last = u[u.length - 1]; if (last?.role === 'agent') u[u.length - 1] = { ...last, content: '无法生成执行计划，请重新描述需求。' }; return u; });
          }
        } catch (e: any) {
          if (e.name !== 'AbortError') setMessages((prev) => { const u = [...prev]; const last = u[u.length - 1]; if (last?.role === 'agent') u[u.length - 1] = { ...last, content: `❌ 计划失败: ${e.message}` }; return u; });
        }
        setSending(false); abortRef.current = null; return;
      }

      // ── Normal chat mode ──
      const projName = projectPath ? projectPath.split(/[\\/]/).pop() || projectPath : '';
      let fullInstruction = languageInstruction(language);
      if (projectPath) fullInstruction += `\n\n【当前项目: ${projName}，路径: ${projectPath}】`;
      fullInstruction += `\n\n${instruction}`;
      if (mode === 'execute') fullInstruction += `\n\n【执行模式：用户意图是直接动手修改，你可以输出 update/create_file 操作。】`;
      const refParts: string[] = [];
      if (mapContext) refParts.push(mapContext);
      if (refParts.length > 0) fullInstruction += `\n\n---\n【参考上下文】\n${refParts.join('\n\n')}`;
      let selectionCtx = null;
      if (selection) {
        const relPath = projectPath ? selection.filePath.replace(projectPath, '').replace(/^[\\/]/, '') : selection.filePath;
        selectionCtx = { file: relPath, text: selection.text, lines: `L${selection.startLine}-L${selection.endLine}` };
      }
      const history: Array<{ role: string; content: string }> = messages.map((m) => ({ role: m.role, content: m.content }));
      // Build user message with context: instruction + open_file + selection
      let userMsg = fullInstruction;
      if (openFileCtx) {
        userMsg += `\n\n【当前打开的文件: ${openFileCtx.path}，共 ${openFileCtx.lines} 行】\n\`\`\`\n${openFileCtx.content}\n\`\`\``;
      }
      if (selectionCtx) {
        userMsg += `\n\n【用户选中的代码: ${selectionCtx.file} ${selectionCtx.lines}】\n用户特意选中了这段代码，请围绕这段代码进行修改：\n\`\`\`\n${selectionCtx.text}\n\`\`\``;
      }
      history.push({ role: 'user', content: userMsg });
      const body: Record<string, any> = { history };
      setMessages((prev) => [...prev, { role: 'agent', content: '', operations: [] }]);

      // Backend handles tool execution internally — frontend just streams and displays
      const { message: fullMessage, operations: finalOps } = await streamAgentResponse(body, abortRef.current?.signal, (token) => {
        setMessages((prev) => { const u = [...prev]; const last = u[u.length - 1]; if (last?.role === 'agent') u[u.length - 1] = { ...last, content: last.content + token }; return u; });
      }, (_toolInfo) => {
        // Tool events from backend — display as steps
        // (tools are executed server-side, shown here for visibility)
      });
      setMessages((prev) => { const u = [...prev]; const last = u[u.length - 1]; if (last?.role === 'agent') u[u.length - 1] = { ...last, content: fullMessage, operations: finalOps }; return u; });
      history.push({ role: 'agent', content: fullMessage });
      if (finalOps.length > 0) {
        onFileChanged?.();
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') setMessages((prev) => [...prev, { role: 'agent', content: `\`\`\`\nError: ${e.message}\n\`\`\`` }]);
    }
    abortRef.current = null; setSending(false);
  };

  return (
    <div className="flex flex-col h-full" style={{ background: '#0d0d0d' }}>
      {/* Header */}
      <div className="px-4 py-2.5 border-b flex items-center gap-2.5 shrink-0" style={{ borderColor: '#1e1e1e', background: '#111111' }}>
        <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #1a3350, #1a4a6e)' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8ab4f8" strokeWidth="2"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/><path d="M8 12h8M12 8v8"/></svg>
        </div>
        <span className="text-[11px] font-medium" style={{ color: '#ccc' }}>AI 助手</span>
        {sending && <span className="w-1.5 h-1.5 rounded-full animate-pulse ml-auto" style={{ background: '#3fb950' }} />}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full px-6 py-12">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'linear-gradient(135deg, #1a3350, #1a4a6e)' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#8ab4f8" strokeWidth="1.5"><path d="M12 2a4 4 0 014 4c0 2-2 3-2 5h-4c0-2-2-3-2-5a4 4 0 014-4z"/><path d="M9 18h6"/><path d="M12 14v4"/></svg>
            </div>
            <div className="text-[13px] font-medium mb-1" style={{ color: '#aaa' }}>{tr(language, 'askAnything')}</div>
            <div className="text-[11px] text-center leading-relaxed" style={{ color: '#555' }}>{tr(language, 'agentHint')}</div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i}>
            {msg.role === 'user' && (
              <div className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-medium" style={{ background: '#1a3350', color: '#8ab4f8' }}>你</div>
                  <div className="flex-1 min-w-0 pt-1">
                    <div className="text-[13px] leading-relaxed whitespace-pre-wrap break-words" style={{ color: '#d4d4d4' }}>{msg.content}</div>
                  </div>
                </div>
              </div>
            )}

            {msg.role === 'agent' && (
              <div className="px-4 py-3" style={{ background: i % 2 === 0 ? '#0a0a0a' : 'transparent' }}>
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[10px] font-medium mt-0.5" style={{ background: '#12261a', color: '#3fb950' }}>AI</div>
                  <div className="flex-1 min-w-0">
                    {msg.content ? (
                      <div className="text-[13px] leading-relaxed" style={{ color: '#c9d1d9' }}>
                        <MarkdownRenderer text={msg.content} />
                      </div>
                    ) : (i === messages.length - 1 && planThinking) ? (
                      <div className="text-[11px] leading-relaxed" style={{ color: '#888' }}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="flex gap-1"><span className="w-1 h-1 rounded-full animate-bounce" style={{ background: '#8ab4f8' }} /><span className="w-1 h-1 rounded-full animate-bounce" style={{ background: '#8ab4f8', animationDelay: '150ms' }} /><span className="w-1 h-1 rounded-full animate-bounce" style={{ background: '#8ab4f8', animationDelay: '300ms' }} /></span>
                          <span className="text-[10px]" style={{ color: '#555' }}>分析项目中...</span>
                        </div>
                        <div className="text-[10px] opacity-60 whitespace-pre-wrap">{planThinking.slice(-200)}</div>
                      </div>
                    ) : (i === messages.length - 1 && sending) ? (
                      <div className="flex items-center gap-1.5 py-1">
                        <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#8ab4f8' }} />
                        <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#8ab4f8', animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: '#8ab4f8', animationDelay: '300ms' }} />
                      </div>
                    ) : null}

                    {msg.steps && msg.steps.length > 0 && (
                      <div className="mt-3 space-y-0.5">
                        {msg.steps.map((step, si) => {
                          const stepKey = `${si}_${step.text}`;
                          const isExpanded = expandedSteps.has(stepKey);
                          return (
                            <div key={si}>
                              <button onClick={() => step.content && setExpandedSteps(prev => { const next = new Set(prev); next.has(stepKey) ? next.delete(stepKey) : next.add(stepKey); return next; })}
                                className={`flex items-center gap-2 text-[11px] w-full text-left transition-colors ${step.content ? 'cursor-pointer hover:bg-white/[0.03] rounded px-1 -mx-1' : ''}`}
                                style={{ color: step.done ? '#666' : '#999' }}>
                                <span className="w-4 text-center shrink-0">{step.icon}</span>
                                <span className="truncate flex-1">{step.text}</span>
                                {!step.done && <span className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0" style={{ background: '#8ab4f8' }} />}
                                {step.done && step.backupId && (
                                  <button onClick={async (e) => { e.stopPropagation(); try { await window.codeatlas.file.restoreBackup(step.backupId!); onFileChanged?.(); } catch { /* */ } }}
                                    className="text-[9px] px-1 rounded hover:bg-white/10 shrink-0" style={{ color: '#d29922' }}>↩</button>
                                )}
                                {step.done && <span className="text-[9px] shrink-0" style={{ color: '#3fb950' }}>✓</span>}
                              </button>
                              {isExpanded && step.content && (
                                <div className="mt-1 ml-6 rounded-lg overflow-hidden border" style={{ borderColor: '#2a2a2a', background: '#0a0a0a' }}>
                                  <pre className="px-3 py-2 text-[10px] leading-relaxed overflow-x-auto max-h-48 whitespace-pre-wrap font-mono" style={{ color: '#c9d1d9' }}>{step.content}</pre>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {msg.operations && msg.operations.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {msg.operations.map((op, j) => {
                          const s = OP_STYLE[op.type] || OP_STYLE.read_file;
                          return (
                            <span key={j} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono" style={{ color: s.color, background: s.bg }}>
                              <span>{s.icon}</span>
                              <span className="max-w-[140px] truncate">{op.file}</span>
                              {op.start_line && <span style={{ opacity: 0.5 }}>:{op.start_line}</span>}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Plan action bar */}
      {plan && !sending && (
        <div className="px-4 py-3 border-t shrink-0 space-y-2" style={{ borderColor: '#1e1e1e', background: '#111111' }}>
          <div className="text-[10px] font-medium" style={{ color: '#888' }}>📋 {plan.steps.length} 个步骤，确认后开始执行</div>
          <div className="flex gap-2">
            <button onClick={executePlan} className="flex-1 px-4 py-2.5 rounded-xl text-[12px] font-medium transition-all hover:opacity-90 active:scale-[0.98] flex items-center justify-center gap-2" style={{ background: 'linear-gradient(135deg, #1a6e3a, #1a8a4a)', color: '#fff' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>开始执行
            </button>
            <button onClick={() => setPlan(null)} className="px-4 py-2.5 rounded-xl text-[12px] transition-all hover:bg-white/5" style={{ background: '#1e1e1e', color: '#888' }}>取消</button>
          </div>
        </div>
      )}

      {/* Input */}
      {!plan && (
      <div className="border-t shrink-0" style={{ borderColor: '#1e1e1e', background: '#0d0d0d' }}>
        {injectContext && (
          <div className="px-4 pt-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px]" style={{ background: '#1a3350', color: '#8ab4f8' }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              {tr(language, 'contextFromFeature')}
              <button onClick={onConsumeContext} className="opacity-50 hover:opacity-100 ml-0.5"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
            </span>
          </div>
        )}
        {selection && (
          <div className="px-4 pt-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px]" style={{ background: '#0f2e1a', color: '#7ee787' }}>
              {selection.filePath.split(/[\\/]/).pop()} L{selection.startLine}-L{selection.endLine}
              <button onClick={onClearSelection} className="opacity-50 hover:opacity-100 ml-0.5"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
            </span>
          </div>
        )}
        <div className="p-3">
          <div className="flex items-end gap-2">
            {sending && (
              <button onClick={handleStop} className="p-2 rounded-lg hover:bg-white/5 shrink-0 transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#f85149"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
              </button>
            )}
            <textarea
              value={input} onChange={(e) => setInput(e.target.value)}
              placeholder={tr(language, 'askAnything')} disabled={sending} rows={1}
              className="flex-1 px-4 py-2.5 text-[13px] leading-relaxed outline-none resize-none rounded-xl transition-colors"
              style={{ background: '#161616', border: '1px solid #2a2a2a', color: '#c9d1d9', fontFamily: 'inherit', opacity: sending ? 0.5 : 1 }}
              onInput={(e) => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px'; }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            />
            {!sending && (
              <button onClick={handleSend} disabled={!input.trim()} className="p-2 rounded-lg hover:bg-white/5 disabled:opacity-30 shrink-0 transition-colors" style={{ color: '#8ab4f8' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </button>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}