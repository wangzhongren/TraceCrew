import { useState, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { GraphNode } from './MapCanvas';
import { useT } from '../i18n';

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

export function getActionConfig(action: ActionType, t: (key: string) => string) {
  const base = ACTION_CONFIGS[action];
  const labels: Record<ActionType, string> = {
    test: t('action.test'), fix: t('action.fix'), refactor: t('action.refactor'),
    explain: t('action.explain'), develop: t('action.develop'),
  };
  const descs: Record<ActionType, string> = {
    test: t('action.testDesc'), fix: t('action.fixDesc'), refactor: t('action.refactorDesc'),
    explain: t('action.explainDesc'), develop: t('action.developDesc'),
  };
  return { ...base, label: labels[action], description: descs[action] };
}

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
  const t = useT();
  const [instruction, setInstruction] = useState('');
  const overlayRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const config = getActionConfig(action, t);
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
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(2px)' }}
      onClick={(e) => { if (e.target === overlayRef.current && !streamRunning) onClose(); }}
    >
      <div
        className="rounded-2xl shadow-2xl overflow-hidden"
        style={{ width: isStreaming ? 720 : 560, maxHeight: '85vh', background: '#ffffff', border: '1px solid var(--color-border-default)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="px-6 py-4 border-b flex items-center gap-3" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <span className="text-2xl">{config.icon}</span>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold tracking-wide" style={{ color: 'var(--color-text-primary)' }}>
              {config.label} · <span style={{ color: config.color }}>{node.label}</span>
            </h2>
            <p className="text-xs mt-0.5" style={{ color: '#6b7280' }}>
              {isStreaming ? (
                <span>
                  {streamPhase === 'review' ? t('action.reviewerVerifying') : streamRunning ? t('action.agentExecuting') : t('action.execComplete')}
                </span>
              ) : config.description}
            </p>
          </div>
          <button onClick={onClose} disabled={streamRunning}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-black/[0.03] transition-colors disabled:opacity-30"
            style={{ color: '#6b7280' }}>
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
                <div className="rounded-xl p-3" style={{ background: '#f8f9fa', border: '1px solid var(--color-border-subtle)' }}>
                  <h3 className="text-caption font-medium mb-2 flex items-center gap-2" style={{ color: '#9ca3af' }}>
                    <span>{t('action.toolExecution')}</span>
                    <span className="px-1.5 py-0.5 rounded text-[9px]" style={{ background: '#e5e7eb', color: '#6b7280' }}>
                      {t('action.operations', { count: streamTools.length })}
                    </span>
                  </h3>
                  <div className="flex flex-wrap gap-1">
                    {streamTools.map((tool, i) => {
                      const toolColor = (() => {
                        switch (tool.type) {
                          case 'read_file': case 'list_dir': case 'search': return { bg: '#dbeafe', text: '#2563eb' };
                          case 'insert_lines': case 'replace_lines': case 'create_file': return { bg: '#dcfce7', text: '#16a34a' };
                          case 'delete_lines': return { bg: '#fee2e2', text: '#dc2626' };
                          case 'run_shell': return { bg: '#fef3c7', text: '#b45309' };
                          default: return { bg: '#f0f1f3', text: 'var(--color-text-secondary)' };
                        }
                      })();
                      return (
                      <span key={i} className="text-[9px] px-2 py-0.5 rounded font-mono"
                        style={{ background: toolColor.bg, color: toolColor.text }}>
                        {tool.type}{tool.file ? `: ${tool.file.split('/').pop()}` : ''}
                      </span>
                    )})}
                  </div>
                </div>
              )}

              {/* Action output */}
              {streamActionOutput && (
                <div className="rounded-xl p-4" style={{ background: '#f8f9fa', border: '1px solid var(--color-border-subtle)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: config.color }} />
                    <span className="text-caption font-medium" style={{ color: '#6b7280' }}>{t('action.agentOutput')}</span>
                    {streamRunning && !streamPhase && (
                      <span className="flex items-center gap-1 text-[9px]" style={{ color: '#9ca3af' }}>
                        <span className="inline-block w-1 h-1 rounded-full animate-pulse" style={{ background: '#22c55e' }}/>
                        {t('action.running')}
                      </span>
                    )}
                  </div>
                  <MarkdownContent text={streamActionOutput} />
                </div>
              )}

              {/* Review output */}
              {streamReviewOutput && (
                <div className="rounded-xl p-4" style={{ background: '#f8f9fa', border: '1px solid #fecaca' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs">🔍</span>
                    <span className="text-caption font-medium" style={{ color: '#dc2626' }}>{t('action.reviewerVerify')}</span>
                  </div>
                  <MarkdownContent text={streamReviewOutput} />
                </div>
              )}

              {/* Result summary */}
              {streamResult && (
                <div className="rounded-xl p-4" style={{
                  background: streamResult.success ? '#f0fdf4' : '#fef2f2',
                  border: `1px solid ${streamResult.review_passed === false ? '#fecaca' : streamResult.success ? '#bbf7d0' : '#fecaca'}`,
                }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm">{streamResult.success ? '✅' : '❌'}</span>
                    <span className="text-xs font-semibold" style={{ color: streamResult.success ? '#22c55e' : '#ff4444' }}>
                      {streamResult.success ? t('action.execComplete') : t('action.execFailed')}
                    </span>
                  </div>
                  {streamResult.message && (
                    <MarkdownContent text={streamResult.message} />
                  )}
                  {streamResult.review_passed !== null && streamResult.review_passed !== undefined && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-caption font-bold px-2 py-0.5 rounded"
                        style={{
                          background: streamResult.review_passed ? '#dcfce7' : '#fee2e2',
                          color: streamResult.review_passed ? '#16a34a' : '#dc2626',
                        }}>
                        {streamResult.review_passed ? 'REVIEW PASSED' : 'REVIEW FAILED'}
                      </span>
                      {streamResult.review_feedback && (
                        <span className="text-caption" style={{ color: '#6b7280' }}>{streamResult.review_feedback}</span>
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
                <div className="rounded-xl p-3" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                  <span className="text-xs" style={{ color: '#ff4444' }}>❌ {streamError}</span>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Node info card — only shown before streaming */}
              <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border-subtle)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 rounded text-caption font-bold tracking-wider"
                    style={{ background: config.color + '20', color: config.color }}>
                    {node.status === 'problem' ? 'ISSUE' :
                     node.status === 'planned_change' ? 'CHANGE' :
                     node.status === 'planned_new' ? 'NEW' : 'EXISTING'}
                  </span>
                  <span className="text-caption font-mono" style={{ color: '#9ca3af' }}>{node.kind}</span>
                </div>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{node.detail || t('action.noDescription')}</p>
                {node.file && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <span className="text-xs font-mono" style={{ color: '#3b82f6' }}>{node.file}{node.line ? `:${node.line}` : ''}</span>
                  </div>
                )}
              </div>

              {/* Context info — varies by action */}
              {action === 'test' && (
                <div className="rounded-xl p-4" style={{ background: '#f8f9fa', border: '1px solid var(--color-border-subtle)' }}>
                  <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('action.testScope')}</h3>
                  <p className="text-xs leading-relaxed" style={{ color: '#6b7280' }}>
                    {t('action.testContext', { name: node.label })}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-caption" style={{ color: '#9ca3af' }}>{t('action.testTypes')}:</span>
                    {[t('action.unitTest'), t('action.integrationTest'), t('action.e2eTest')].map(label => (
                      <span key={label} className="text-caption px-2 py-0.5 rounded" style={{ background: '#e5e7eb', color: 'var(--color-text-secondary)' }}>{label}</span>
                    ))}
                  </div>
                </div>
              )}

              {action === 'fix' && (
                <div className="rounded-xl p-4" style={{ background: '#f8f9fa', border: '1px solid var(--color-border-subtle)' }}>
                  <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('action.fixScope')}</h3>
                  <p className="text-xs leading-relaxed" style={{ color: '#6b7280' }}>
                    {t('action.fixContext', { name: node.label })}
                  </p>
                </div>
              )}

              {action === 'refactor' && (
                <div className="rounded-xl p-4" style={{ background: '#f8f9fa', border: '1px solid var(--color-border-subtle)' }}>
                  <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('action.refactorScope')}</h3>
                  <p className="text-xs leading-relaxed" style={{ color: '#6b7280' }}>
                    {t('action.refactorContext', { name: node.label })}
                    {downstreamCount > 0 && (
                      <span>{t('action.downstreamCount', { count: downstreamCount })}</span>
                    )}。
                  </p>
                  {downstreamNodes && downstreamNodes.length > 0 && (
                    <div className="mt-3 space-y-1">
                      <span className="text-caption" style={{ color: '#9ca3af' }}>{t('action.affectedNodes')}</span>
                      {downstreamNodes.slice(0, 10).map((n) => (
                        <div key={n.id} className="flex items-center gap-2 text-caption pl-2 py-0.5">
                          <span className="w-1 h-1 rounded-full" style={{ background: config.color }} />
                          <span style={{ color: 'var(--color-text-secondary)' }}>{n.label}</span>
                          {n.file && <span className="font-mono" style={{ color: '#9ca3af' }}>{n.file.split('/').pop()}</span>}
                        </div>
                      ))}
                      {downstreamNodes.length > 10 && (
                        <span className="text-caption" style={{ color: '#9ca3af' }}>{t('action.moreNodes', { count: downstreamNodes.length - 10 })}</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {action === 'explain' && (
                <div className="rounded-xl p-4" style={{ background: '#f8f9fa', border: '1px solid var(--color-border-subtle)' }}>
                  <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('action.docGeneration')}</h3>
                  <ul className="space-y-1 text-xs" style={{ color: '#6b7280' }}>
                    {[t('action.docItem1'), t('action.docItem2'), t('action.docItem3'), t('action.docItem4'), t('action.docItem5')].map(item => (
                      <li key={item}>· {item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {action === 'develop' && (
                <div className="rounded-xl p-4" style={{ background: '#f8f9fa', border: '1px solid var(--color-border-subtle)' }}>
                  <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('action.devTask')}</h3>
                  <p className="text-xs leading-relaxed" style={{ color: '#6b7280' }}>
                    {t('action.devContext', { name: node.label })}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    {[t('action.createFiles'), t('action.implFunctions'), t('action.buildCallChain')].map(label => (
                      <span key={label} className="text-caption px-2 py-0.5 rounded" style={{ background: '#e5e7eb', color: 'var(--color-text-secondary)' }}>{label}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Instruction input */}
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: '#6b7280' }}>
                  {t('action.additionalInstructions')} <span className="font-light" style={{ color: '#9ca3af' }}>{t('action.optional')}</span>
                </label>
                <textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder={
                    action === 'test' ? t('action.testPlaceholder') :
                    action === 'fix' ? t('action.fixPlaceholder') :
                    action === 'refactor' ? t('action.refactorPlaceholder') :
                    action === 'explain' ? t('action.explainPlaceholder') :
                    t('action.developPlaceholder')
                  }
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg text-sm bg-transparent resize-none outline-none transition-colors focus:ring-1"
                  style={{
                    background: '#f8f9fa',
                    border: '1px solid var(--color-border-subtle)',
                    color: 'var(--color-text-secondary)',
                    fontFamily: 'var(--ibm-font)',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = config.color; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = '#e5e7eb'; }}
                />
              </div>
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t flex items-center justify-between" style={{ borderColor: 'var(--color-border-subtle)' }}>
          {isStreaming ? (
            <>
              {streamRunning ? (
                <span className="text-caption" style={{ color: '#9ca3af' }}>{t('action.agentProcessing')}</span>
              ) : streamResult?.review_passed === false ? (
                <span className="text-caption" style={{ color: '#ff4444' }}>{t('action.reviewerFailed')}</span>
              ) : (
                <span className="text-caption" style={{ color: '#22c55e' }}>{t('action.processingComplete')}</span>
              )}
              <button
                onClick={onClose}
                disabled={streamRunning}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-black/[0.03] disabled:opacity-30"
                style={{ color: '#6b7280' }}
              >
                {streamRunning ? t('action.processing') : t('common.close')}
              </button>
            </>
          ) : (
            <>
              <span className="text-caption" style={{ color: '#9ca3af' }}>
                {t('action.autoBackup')}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-all hover:bg-black/[0.03] active:scale-[0.98]"
                  style={{ color: '#6b7280' }}
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleConfirm}
                  className="px-5 py-2 rounded-lg text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
                  style={{ background: config.color, color: '#fff' }}
                >
                  {t('action.startAction', { label: config.label })}
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
              ? <code className="px-1 py-0.5 rounded text-caption" style={{ background: '#f0f1f3', color: 'var(--color-text-link)' }} {...props}>{children}</code>
              : <code className={className} {...props}>{children}</code>;
          },
          pre: ({ children }: any) => <pre className="code-block" style={{ color: 'var(--color-text-secondary)' }}>{children}</pre>,
          ul: ({ children }: any) => <ul className="list-disc pl-5 mb-1 space-y-0.5" style={{ color: 'var(--color-text-secondary)' }}>{children}</ul>,
          ol: ({ children }: any) => <ol className="list-decimal pl-5 mb-1 space-y-0.5" style={{ color: 'var(--color-text-secondary)' }}>{children}</ol>,
          li: ({ children }: any) => <li className="my-0.5" style={{ color: 'var(--color-text-secondary)' }}>{children}</li>,
          strong: ({ children }: any) => <strong className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{children}</strong>,
          a: ({ href, children }: any) => <a href={href} target="_blank" className="no-underline hover:underline" style={{ color: '#3b82f6' }}>{children}</a>,
          hr: () => <hr className="my-2" style={{ borderColor: 'var(--color-border-subtle)' }} />,
          blockquote: ({ children }: any) => <blockquote className="border-l-2 pl-2 my-1 italic opacity-70" style={{ borderColor: 'var(--color-border-default)', color: '#6b7280' }}>{children}</blockquote>,
          table: ({ children }: any) => <div className="overflow-x-auto my-2"><table className="w-full text-caption border-separate border-spacing-0">{children}</table></div>,
          th: ({ children }: any) => <th className="border border-subtle bg-layer px-2 py-1 text-caption font-medium" style={{ color: 'var(--color-text-primary)' }}>{children}</th>,
          td: ({ children }: any) => <td className="border border-subtle px-2 py-1 text-caption" style={{ color: 'var(--color-text-secondary)' }}>{children}</td>,
        }}>
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}
