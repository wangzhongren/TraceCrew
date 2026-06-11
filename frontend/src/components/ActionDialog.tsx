import { useState, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { GraphNode } from './MapCanvas';

export type ActionType = 'test' | 'fix' | 'refactor' | 'explain' | 'develop';

interface ActionConfig {
  type: ActionType;
  label: string;
  icon: string;
  color: string;
  description: string;
}

export const ACTION_CONFIGS: Record<ActionType, ActionConfig> = {
  test: {
    type: 'test',
    label: '测试',
    icon: '🧪',
    color: '#4a9eff',
    description: '对选中的节点范围运行测试，验证功能正确性',
  },
  fix: {
    type: 'fix',
    label: '修复',
    icon: '🔧',
    color: '#ff4444',
    description: '修复选中节点的问题，只针对该节点及其直接关联代码',
  },
  refactor: {
    type: 'refactor',
    label: '重构',
    icon: '♻️',
    color: '#f0c000',
    description: '重构选中节点及其所有下游节点，优化结构和可维护性',
  },
  explain: {
    type: 'explain',
    label: '解释',
    icon: '📝',
    color: '#a371f7',
    description: '生成详细的 Markdown 文档，解释选中节点的逻辑、调用关系和数据流',
  },
  develop: {
    type: 'develop',
    label: '开发',
    icon: '🚀',
    color: '#22c55e',
    description: '完成该新功能的开发，生成所需代码和调用链路',
  },
};

/** Return available actions for a given node status */
export function getActionsForNode(status: string): ActionType[] {
  switch (status) {
    case 'problem':
      return ['fix', 'test', 'explain'];
    case 'planned_change':
      return ['fix', 'refactor', 'test', 'explain'];
    case 'planned_new':
      return ['develop', 'test', 'explain'];
    case 'existing':
    default:
      return ['refactor', 'explain'];
  }
}

interface Props {
  action: ActionType;
  node: GraphNode;
  downstreamNodes?: GraphNode[];
  onClose: () => void;
  onConfirm: (instruction: string) => Promise<void>;
  /** Streaming state from backend */
  streamRunning?: boolean;
  streamPhase?: string | null;
  streamActionOutput?: string;
  streamReviewOutput?: string;
  streamTools?: Array<{ type: string; file: string }>;
  streamResult?: any | null;
  streamError?: string | null;
}

export default function ActionDialog({
  action, node, downstreamNodes, onClose, onConfirm,
  streamRunning, streamPhase, streamActionOutput, streamReviewOutput,
  streamTools, streamResult, streamError,
}: Props) {
  const [instruction, setInstruction] = useState('');
  const overlayRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const config = ACTION_CONFIGS[action];
  const isStreaming = streamRunning || streamResult || streamError;

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !streamRunning) onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose, streamRunning]);

  // Auto-scroll streaming output
  useEffect(() => {
    if (isStreaming && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [streamActionOutput, streamReviewOutput, isStreaming]);

  const handleConfirm = () => {
    onConfirm(instruction);
  };

  const downstreamCount = downstreamNodes?.length || 0;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }}
      onClick={(e) => { if (e.target === overlayRef.current && !streamRunning) onClose(); }}
    >
      <div
        className="rounded-2xl shadow-2xl overflow-hidden"
        style={{ width: isStreaming ? 720 : 560, maxHeight: '85vh', background: '#161b22', border: '1px solid var(--color-border-default)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="px-6 py-4 border-b flex items-center gap-3" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <span className="text-2xl">{config.icon}</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold tracking-wide" style={{ color: 'var(--color-text-primary)' }}>
              {config.label} · <span style={{ color: config.color }}>{node.label}</span>
            </h2>
            <p className="text-xs mt-0.5" style={{ color: '#8b949e' }}>
              {isStreaming ? (
                <span>
                  {streamPhase === 'review' ? '🔍 Reviewer 验收中...' : streamRunning ? '⏳ Agent 正在执行...' : '✅ 执行完成'}
                </span>
              ) : config.description}
            </p>
          </div>
          <button onClick={onClose} disabled={streamRunning}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/5 transition-colors disabled:opacity-30"
            style={{ color: '#8b949e' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* ── Body ── */}
        <div ref={outputRef} className="px-6 py-4 space-y-4 overflow-y-auto" style={{ maxHeight: '60vh' }}>
          {/* Streaming output */}
          {isStreaming ? (
            <>
              {/* Tools executed */}
              {streamTools && streamTools.length > 0 && (
                <div className="rounded-xl p-3" style={{ background: '#0d1117', border: '1px solid var(--color-border-subtle)' }}>
                  <h3 className="text-caption font-medium mb-2 flex items-center gap-2" style={{ color: '#484f58' }}>
                    <span>🔧 工具执行</span>
                    <span className="px-1.5 py-0.5 rounded text-[9px]" style={{ background: '#21262d', color: '#8b949e' }}>
                      {streamTools.length} 个操作
                    </span>
                  </h3>
                  <div className="flex flex-wrap gap-1">
                    {streamTools.map((t, i) => (
                      <span key={i} className="text-[9px] px-2 py-0.5 rounded font-mono"
                        style={{ background: '#21262d', color: 'var(--color-text-secondary)' }}>
                        {t.type}{t.file ? `: ${t.file.split('/').pop()}` : ''}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Action output */}
              {streamActionOutput && (
                <div className="rounded-xl p-4" style={{ background: '#0d1117', border: '1px solid var(--color-border-subtle)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: config.color }} />
                    <span className="text-caption font-medium" style={{ color: '#8b949e' }}>Agent 输出</span>
                    {streamRunning && !streamPhase && (
                      <span className="flex items-center gap-1 text-[9px]" style={{ color: '#484f58' }}>
                        <span className="inline-block w-1 h-1 rounded-full animate-pulse" style={{ background: '#22c55e' }}/>
                        运行中...
                      </span>
                    )}
                  </div>
                  <MarkdownContent text={streamActionOutput} />
                </div>
              )}

              {/* Review output */}
              {streamReviewOutput && (
                <div className="rounded-xl p-4" style={{ background: '#0d1117', border: '1px solid #ff444430' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs">🔍</span>
                    <span className="text-caption font-medium" style={{ color: '#e0888d' }}>Reviewer 验收</span>
                  </div>
                  <MarkdownContent text={streamReviewOutput} />
                </div>
              )}

              {/* Result summary */}
              {streamResult && (
                <div className="rounded-xl p-4" style={{
                  background: streamResult.success ? '#0a1f1210' : '#2a101510',
                  border: `1px solid ${streamResult.review_passed === false ? '#ff444440' : streamResult.success ? '#22c55e30' : '#ff444440'}`,
                }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm">{streamResult.success ? '✅' : '❌'}</span>
                    <span className="text-xs font-semibold" style={{ color: streamResult.success ? '#22c55e' : '#ff4444' }}>
                      {streamResult.success ? '执行完成' : '执行失败'}
                    </span>
                  </div>
                  {streamResult.message && (
                    <MarkdownContent text={streamResult.message} />
                  )}
                  {streamResult.review_passed !== null && streamResult.review_passed !== undefined && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-caption font-bold px-2 py-0.5 rounded"
                        style={{
                          background: streamResult.review_passed ? '#22c55e20' : '#ff444420',
                          color: streamResult.review_passed ? '#22c55e' : '#ff4444',
                        }}>
                        {streamResult.review_passed ? 'REVIEW PASSED' : 'REVIEW FAILED'}
                      </span>
                      {streamResult.review_feedback && (
                        <span className="text-caption" style={{ color: '#8b949e' }}>{streamResult.review_feedback}</span>
                      )}
                    </div>
                  )}
                  {streamResult.review_issues?.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {streamResult.review_issues.map((issue: any, j: number) => (
                        <div key={j} className="text-caption flex items-start gap-1.5" style={{ color: '#ff4444' }}>
                          <span className="shrink-0 mt-0.5">⚠</span>
                          <span>[{issue.severity || '?'}] {issue.file || '?'}: {issue.claim || ''}{issue.reality ? ` → ${issue.reality}` : ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Error */}
              {streamError && (
                <div className="rounded-xl p-3" style={{ background: '#2a1015', border: '1px solid #ff444430' }}>
                  <span className="text-xs" style={{ color: '#ff4444' }}>❌ {streamError}</span>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Node info card — only shown before streaming */}
              <div className="rounded-xl p-4" style={{ background: '#0d1117', border: '1px solid var(--color-border-subtle)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 rounded text-caption font-bold tracking-wider"
                    style={{ background: config.color + '20', color: config.color }}>
                    {node.status === 'problem' ? 'ISSUE' :
                     node.status === 'planned_change' ? 'CHANGE' :
                     node.status === 'planned_new' ? 'NEW' : 'EXISTING'}
                  </span>
                  <span className="text-caption font-mono" style={{ color: '#484f58' }}>{node.kind}</span>
                </div>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{node.detail || '无详细描述'}</p>
                {node.file && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="1.5">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <span className="text-xs font-mono" style={{ color: '#58a6ff' }}>{node.file}{node.line ? `:${node.line}` : ''}</span>
                  </div>
                )}
              </div>

              {/* Context info — varies by action */}
              {action === 'test' && (
                <div className="rounded-xl p-4" style={{ background: '#0d1117', border: '1px solid var(--color-border-subtle)' }}>
                  <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>🧪 测试范围</h3>
                  <p className="text-xs leading-relaxed" style={{ color: '#8b949e' }}>
                    将对 <span style={{ color: config.color, fontWeight: 600 }}>{node.label}</span> 及其关联链路执行完整测试。
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-caption" style={{ color: '#484f58' }}>测试类型:</span>
                    {['单元测试', '集成测试', '端到端'].map(t => (
                      <span key={t} className="text-caption px-2 py-0.5 rounded" style={{ background: '#21262d', color: 'var(--color-text-secondary)' }}>{t}</span>
                    ))}
                  </div>
                </div>
              )}

              {action === 'fix' && (
                <div className="rounded-xl p-4" style={{ background: '#0d1117', border: '1px solid var(--color-border-subtle)' }}>
                  <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>🔧 修复范围</h3>
                  <p className="text-xs leading-relaxed" style={{ color: '#8b949e' }}>
                    仅修复 <span style={{ color: config.color, fontWeight: 600 }}>{node.label}</span> 节点的问题。
                  </p>
                </div>
              )}

              {action === 'refactor' && (
                <div className="rounded-xl p-4" style={{ background: '#0d1117', border: '1px solid var(--color-border-subtle)' }}>
                  <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>♻️ 重构范围</h3>
                  <p className="text-xs leading-relaxed" style={{ color: '#8b949e' }}>
                    以 <span style={{ color: config.color, fontWeight: 600 }}>{node.label}</span> 为起点，
                    重构该节点及其所有下游节点
                    {downstreamCount > 0 && (
                      <span>（共 <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{downstreamCount}</span> 个下游节点）</span>
                    )}。
                  </p>
                  {downstreamNodes && downstreamNodes.length > 0 && (
                    <div className="mt-3 space-y-1">
                      <span className="text-caption" style={{ color: '#484f58' }}>影响节点:</span>
                      {downstreamNodes.slice(0, 10).map((n) => (
                        <div key={n.id} className="flex items-center gap-2 text-caption pl-2 py-0.5">
                          <span className="w-1 h-1 rounded-full" style={{ background: config.color }} />
                          <span style={{ color: 'var(--color-text-secondary)' }}>{n.label}</span>
                          {n.file && <span className="font-mono" style={{ color: '#484f58' }}>{n.file.split('/').pop()}</span>}
                        </div>
                      ))}
                      {downstreamNodes.length > 10 && (
                        <span className="text-caption" style={{ color: '#484f58' }}>...还有 {downstreamNodes.length - 10} 个节点</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {action === 'explain' && (
                <div className="rounded-xl p-4" style={{ background: '#0d1117', border: '1px solid var(--color-border-subtle)' }}>
                  <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>📝 文档生成</h3>
                  <ul className="space-y-1 text-xs" style={{ color: '#8b949e' }}>
                    {['功能概述与业务逻辑', '调用链路与数据流图', '关键函数签名与参数说明', '上下游依赖关系', '边界情况与注意事项'].map(item => (
                      <li key={item}>· {item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {action === 'develop' && (
                <div className="rounded-xl p-4" style={{ background: '#0d1117', border: '1px solid var(--color-border-subtle)' }}>
                  <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>🚀 开发任务</h3>
                  <p className="text-xs leading-relaxed" style={{ color: '#8b949e' }}>
                    完成 <span style={{ color: config.color, fontWeight: 600 }}>{node.label}</span> 新功能的开发。
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    {['新建文件', '实现函数', '建立调用链'].map(t => (
                      <span key={t} className="text-caption px-2 py-0.5 rounded" style={{ background: '#21262d', color: 'var(--color-text-secondary)' }}>{t}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Instruction input */}
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: '#8b949e' }}>
                  补充说明 <span className="font-light" style={{ color: '#484f58' }}>（可选）</span>
                </label>
                <textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder={
                    action === 'test' ? '指定测试范围或测试策略...' :
                    action === 'fix' ? '描述已知的问题原因或修复方向...' :
                    action === 'refactor' ? '描述重构目标和期望的架构方向...' :
                    action === 'explain' ? '指定文档侧重点或需要强调的内容...' :
                    '描述功能需求和技术约束...'
                  }
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg text-sm bg-transparent resize-none outline-none transition-colors focus:ring-1"
                  style={{
                    background: '#0d1117',
                    border: '1px solid var(--color-border-subtle)',
                    color: 'var(--color-text-secondary)',
                    fontFamily: 'var(--ibm-font)',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = config.color; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = '#21262d'; }}
                />
              </div>
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t flex items-center justify-between" style={{ borderColor: 'var(--color-border-subtle)' }}>
          {isStreaming ? (
            <>
              <span className="text-caption" style={{ color: '#484f58' }}>
                {streamRunning ? '⏳ Agent 正在处理，请等待...' : streamResult ? '✅ 处理完成，可关闭窗口' : ''}
              </span>
              <button
                onClick={onClose}
                disabled={streamRunning}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-white/5 disabled:opacity-30"
                style={{ color: '#8b949e' }}
              >
                {streamRunning ? '处理中...' : '关闭'}
              </button>
            </>
          ) : (
            <>
              <span className="text-caption" style={{ color: '#484f58' }}>
                AI Agent 将读取文件并执行操作，修改前自动备份
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-white/5"
                  style={{ color: '#8b949e' }}
                >
                  取消
                </button>
                <button
                  onClick={handleConfirm}
                  className="px-5 py-2 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
                  style={{ background: config.color, color: '#fff' }}
                >
                  开始{config.label}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Inline Markdown renderer (matches project dark theme) ── */

function MarkdownContent({ text }: { text: string }) {
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
    <div className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }: any) => <h1 className="text-body font-semibold mt-3 mb-1" style={{ color: 'var(--color-text-primary)' }}>{children}</h1>,
          h2: ({ children }: any) => <h2 className="text-sm font-semibold mt-2 mb-1" style={{ color: 'var(--color-text-primary)' }}>{children}</h2>,
          h3: ({ children }: any) => <h3 className="text-xs font-semibold mt-2 mb-1" style={{ color: 'var(--color-text-primary)' }}>{children}</h3>,
          h4: ({ children }: any) => <h4 className="text-xs font-medium mt-1.5 mb-0.5" style={{ color: 'var(--color-text-primary)' }}>{children}</h4>,
          p: ({ children }: any) => <p className="my-1 last:mb-0" style={{ color: 'var(--color-text-secondary)' }}>{children}</p>,
          code: ({ className, children, ...props }: any) => {
            const inline = !className;
            return inline
              ? <code className="px-1 py-0.5 rounded text-caption" style={{ background: '#1a1a2e', color: 'var(--color-text-link)' }} {...props}>{children}</code>
              : <code className={className} {...props}>{children}</code>;
          },
          pre: ({ children }: any) => <pre className="code-block" style={{ color: 'var(--color-text-secondary)' }}>{children}</pre>,
          ul: ({ children }: any) => <ul className="list-disc pl-5 mb-1 space-y-0.5" style={{ color: 'var(--color-text-secondary)' }}>{children}</ul>,
          ol: ({ children }: any) => <ol className="list-decimal pl-5 mb-1 space-y-0.5" style={{ color: 'var(--color-text-secondary)' }}>{children}</ol>,
          li: ({ children }: any) => <li className="my-0.5" style={{ color: 'var(--color-text-secondary)' }}>{children}</li>,
          strong: ({ children }: any) => <strong className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{children}</strong>,
          a: ({ href, children }: any) => <a href={href} target="_blank" className="no-underline hover:underline" style={{ color: '#58a6ff' }}>{children}</a>,
          hr: () => <hr className="my-2" style={{ borderColor: 'var(--color-border-subtle)' }} />,
          blockquote: ({ children }: any) => <blockquote className="border-l-2 pl-2 my-1 italic opacity-70" style={{ borderColor: 'var(--color-border-default)', color: '#8b949e' }}>{children}</blockquote>,
          table: ({ children }: any) => <div className="overflow-x-auto my-2"><table className="w-full text-caption border-separate border-spacing-0">{children}</table></div>,
          th: ({ children }: any) => <th className="border border-subtle bg-layer px-2 py-1 text-caption font-medium" style={{ color: 'var(--color-text-primary)' }}>{children}</th>,
          td: ({ children }: any) => <td className="border border-subtle px-2 py-1 text-caption" style={{ color: 'var(--color-text-secondary)' }}>{children}</td>,
        }}>
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}
