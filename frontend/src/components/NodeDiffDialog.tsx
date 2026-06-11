import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { GraphNode } from './MapCanvas';
import type { ActionType } from './ActionDialog';
import { ACTION_CONFIGS } from './ActionDialog';

interface Props {
  action: ActionType;
  node: GraphNode;
  projectPath: string;
  onClose: () => void;
}

type Phase = 'loading' | 'streaming' | 'diff' | 'done';

function cleanTags(text: string): string {
  return text
    .replace(/<(list-dir|read-file|run-shell|update|create-file|delete-file|search)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(list-dir|read-file|run-shell|update|create-file|delete-file|search)\b[^>]*\/>/gi, '')
    .replace(/<done>[^<]*<\/done>/gi, '')
    .replace(/<final\/>/gi, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}

export default function NodeDiffDialog({ action, node, projectPath, onClose }: Props) {
  const config = ACTION_CONFIGS[action];
  const isReadOnly = action === 'explain';
  const [phase, setPhase] = useState<Phase>('loading');
  const [originalCode, setOriginalCode] = useState('');
  const [modifiedCode, setModifiedCode] = useState('');
  const [agentOutput, setAgentOutput] = useState('');
  const [tools, setTools] = useState<Array<{ type: string; file: string }>>([]);
  const [result, setResult] = useState<any>(null);
  const [modifiedFiles, setModifiedFiles] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  // Load original code on mount
  useEffect(() => {
    (async () => {
      if (!node.file) { setPhase('streaming'); return; }
      try {
        const content = await window.codeatlas.file.readFile(node.file);
        setOriginalCode(content.content);
      } catch { setOriginalCode('// Unable to read file'); }
      setPhase('streaming');
    })();
  }, [node.file]);

  // Start SSE stream
  useEffect(() => {
    if (phase !== 'streaming') return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    (async () => {
      try {
        const res = await fetch('/api/v1/agent/action/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            node,
            project_path: projectPath,
            instruction: '',
          }),
          signal: ctrl.signal,
        });

        const reader = res.body?.getReader();
        if (!reader) { console.error('无法读取响应流'); return; }

        const dec = new TextDecoder();
        let buf = '';
        let output = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() || '';

          for (const part of parts) {
            const lines = part.split('\n');
            let event = '', data = '';
            for (const l of lines) {
              if (l.startsWith('event: ')) event = l.slice(7).trim();
              else if (l.startsWith('data: ')) data = l.slice(6);
            }
            if (!event) continue;

            try { JSON.parse(data); } catch {}

            switch (event) {
              case 'phase':
                break;
              case 'token':
                output += data;
                setAgentOutput(prev => prev + data);
                break;
              case 'tools': {
                const td = JSON.parse(data);
                setTools(prev => [...prev, ...(td.ops || [])]);
                // Track modified files
                for (const op of (td.ops || [])) {
                  if (['insert_lines', 'replace_lines', 'delete_lines', 'create_file'].includes(op.type) && op.file) {
                    setModifiedFiles(prev => prev.includes(op.file) ? prev : [...prev, op.file]);
                  }
                }
                break;
              }
              case 'done': {
                const payload = JSON.parse(data);
                setResult(payload);
                // Read modified files for diff
                if (!isReadOnly && modifiedFiles.length > 0) {
                  const filePath = modifiedFiles[0];
                  try {
                    const after = await window.codeatlas.file.readFile(filePath);
                    setModifiedCode(after.content);
                  } catch { /* */ }
                }
                setPhase(payload.review_passed !== false ? 'done' : 'diff');
                break;
              }
            }
          }
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') console.error(e.message || '网络错误');
      }
    })();

    return () => { ctrl.abort(); };
  }, [phase === 'streaming']);

  const handleAccept = () => { onClose(); };
  const handleReject = async () => {
    for (const f of modifiedFiles) {
      try {
        // Find the latest backup and restore
        const backups = await listBackups(projectPath);
        const latest = backups.find((b: any) => b.file === f);
        if (latest) await window.codeatlas.file.restoreBackup(latest.id);
      } catch { /* */ }
    }
    onClose();
  };

  const cleanedOutput = cleanTags(agentOutput);
  const leftTitle = isReadOnly ? '原始代码' : '修改前';
  const rightTitle = isReadOnly ? '分析文档' : (modifiedCode ? '修改后' : 'Agent 输出');

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: 'var(--color-bg-primary)' }}>
      {/* Header */}
      <div className="flex items-center justify-between h-10 shrink-0 px-4 border-b border-subtle" style={{ background: 'var(--color-bg-layer)' }}>
        <div className="flex items-center gap-2">
          <span className="text-lg">{config.icon}</span>
          <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{config.label}</span>
          <span style={{ color: config.color }}>· {node.label}</span>
          {node.file && <span className="text-caption text-muted font-mono">{node.file}{node.line ? `:${node.line}` : ''}</span>}
        </div>
        <div className="flex items-center gap-2">
          {phase === 'streaming' && <span className="text-caption text-muted">⏳ 执行中...</span>}
          {phase === 'done' && !isReadOnly && result?.review_passed !== false && (
            <>
              <button onClick={handleReject}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-white/5"
                style={{ color: 'var(--color-status-problem)', border: '1px solid var(--color-status-problem)' }}>
                拒绝并还原
              </button>
              <button onClick={handleAccept}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{ background: 'var(--color-status-new)', color: '#fff' }}>
                允许修改
              </button>
            </>
          )}
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/5 text-muted">✕</button>
        </div>
      </div>

      {/* Dual pane body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: original code */}
        <div ref={leftRef} className="flex-1 flex flex-col border-r border-subtle overflow-hidden" style={{ minWidth: 0 }}>
          <div className="shrink-0 px-3 py-1.5 border-b border-subtle text-caption text-muted font-medium">{leftTitle}</div>
          <div className="flex-1 overflow-auto">
            <pre className="p-4 text-xs leading-relaxed font-mono whitespace-pre" style={{ color: 'var(--color-text-secondary)' }}>
              {originalCode || '加载中...'}
            </pre>
          </div>
        </div>

        {/* Right: agent output / modified code */}
        <div ref={rightRef} className="flex-1 flex flex-col overflow-hidden" style={{ minWidth: 0 }}>
          <div className="shrink-0 px-3 py-1.5 border-b border-subtle text-caption text-muted font-medium">{rightTitle}</div>
          <div className="flex-1 overflow-auto p-4">
            {isReadOnly ? (
              <div className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }: any) => <h1 className="text-md font-semibold mt-3 mb-1" style={{ color: 'var(--color-text-primary)' }}>{children}</h1>,
                    h2: ({ children }: any) => <h2 className="text-sm font-semibold mt-2 mb-1" style={{ color: 'var(--color-text-primary)' }}>{children}</h2>,
                    h3: ({ children }: any) => <h3 className="text-xs font-semibold mt-2 mb-1" style={{ color: 'var(--color-text-primary)' }}>{children}</h3>,
                    p: ({ children }: any) => <p className="my-1 last:mb-0">{children}</p>,
                    code: ({ className, children, ...props }: any) => {
                      const inline = !className;
                      return inline
                        ? <code className="px-1 py-0.5 rounded text-caption" style={{ background: '#1a1a2e', color: 'var(--color-text-link)' }} {...props}>{children}</code>
                        : <code className={className} {...props}>{children}</code>;
                    },
                    pre: ({ children }: any) => <pre className="code-block">{children}</pre>,
                  }}>
                  {cleanedOutput}
                </ReactMarkdown>
              </div>
            ) : modifiedCode ? (
              <DiffView original={originalCode} modified={modifiedCode} />
            ) : (
              <pre className="text-xs leading-relaxed font-mono whitespace-pre-wrap" style={{ color: 'var(--color-text-secondary)' }}>
                {cleanedOutput || '执行中...'}
              </pre>
            )}
          </div>
        </div>
      </div>

      {/* Status bar */}
      {tools.length > 0 && (
        <div className="shrink-0 h-7 flex items-center gap-2 px-3 border-t border-subtle text-caption text-muted">
          <span>🔧 {tools.length} 操作:</span>
          {tools.slice(0, 5).map((t, i) => (
            <span key={i} className="font-mono">{t.type}{t.file ? ` ${t.file.split('/').pop()}` : ''}</span>
          ))}
          {tools.length > 5 && <span>...</span>}
        </div>
      )}
    </div>
  );
}

/* ── Simple inline diff view ── */
function DiffView({ original, modified }: { original: string; modified: string }) {
  const origLines = original.split('\n');
  const modLines = modified.split('\n');
  const maxLen = Math.max(origLines.length, modLines.length);

  return (
    <div className="text-xs font-mono leading-relaxed">
      {Array.from({ length: maxLen }, (_, i) => {
        const orig = origLines[i];
        const mod = modLines[i];
        if (orig === mod) return null; // skip unchanged
        return (
          <div key={i} className="flex">
            <span className="shrink-0 w-10 text-right pr-3 select-none" style={{ color: 'var(--color-text-disabled)' }}>{i + 1}</span>
            {orig !== undefined && orig !== mod && (
              <span className="flex-1 whitespace-pre-wrap" style={{ background: '#2a1015', color: '#fcc5c5' }}>- {orig}</span>
            )}
            {mod !== undefined && orig !== mod && (
              <span className="flex-1 whitespace-pre-wrap" style={{ background: '#0a1f12', color: '#a0f0c0' }}>+ {mod}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Helper: list available backups */
async function listBackups(projectPath: string): Promise<Array<{ id: string; file: string }>> {
  try {
    // Read .codeatlas/backups directory
    const entries = await window.codeatlas.file.listDirectory(projectPath + '/.codeatlas/backups');
    if (!entries || !Array.isArray(entries)) return [];
    return entries
      .filter((e: any) => e.type === 'directory')
      .map((e: any) => ({
        id: e.name,
        file: '', // would need to read meta.json — skipped for simplicity
      }));
  } catch { return []; }
}
