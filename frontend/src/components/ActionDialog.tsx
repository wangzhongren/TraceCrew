import { useState, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { GraphNode } from '../types/graph';
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
    icon: '',
    color: '#35608f',
    description: '对选中的节点范围运行测试，验证功能正确性',
  },
  fix: {
    type: 'fix',
    label: '修复',
    icon: '',
    color: '#c2452e',
    description: '修复选中节点的问题，只针对该节点及其直接关联代码',
  },
  refactor: {
    type: 'refactor',
    label: '重构',
    icon: '',
    color: '#a97b2a',
    description: '重构选中节点及其所有下游节点，优化结构和可维护性',
  },
  explain: {
    type: 'explain',
    label: '解释',
    icon: '',
    color: '#6b5b95',
    description: '生成详细的 Markdown 文档，解释选中节点的逻辑、调用关系和数据流',
  },
  develop: {
    type: 'develop',
    label: '开发',
    icon: '',
    color: '#2f7d5f',
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

/* ── Shared protocol-tag cleaner（F3：5 个 Agent 面板共用的唯一清洗实现）── */

/** 操作标签名：成对块与自闭合形态都要被整体剔除（连内容）。 */
const OPERATION_TAG_NAMES = 'list-dir|read-file|run-shell|update|create-file|delete-file|search';

/** 已知协议标签名全集：操作标签 + 终态/交接标记 + 保留内容的容器标签。 */
const PROTOCOL_TAG_NAMES = `${OPERATION_TAG_NAMES}|final|done|handoff-to-planner|skip-architect|step-done|all-done|confirmed-requirement`;

/**
 * 清洗 Agent 流式文本里的协议标签，供 ChatPanel / PlanCard / ReviewCard /
 * ActionDialog / ActionPanel 在渲染期统一调用（F3 单点维护）。规则分四类：
 *  1. 操作标签（list-dir 等）：成对块连内容一起剔除；自闭合形态直接剔除；
 *  2. 保留内容的容器标签（confirmed-requirement）：仅去掉开闭标签、保留内部文本；
 *  3. 自闭合终态/协议标记（final / done / handoff-to-planner / skip-architect /
 *     step-done / all-done）：直接移除；成对的 done / step-done / all-done 连内容剔除；
 *  4. 未闭合的已知标签片段（只有开片段、无闭合）：按标签名精确匹配、行内剥离，
 *     普通文本与合法 HTML（如 <b>、<dataFile>）不受影响。
 * 最后压缩连续空行并去掉首尾空白。
 */
export function cleanProtocolTags(text: string): string {
  if (!text) return '';
  const operationSelfClosing = new RegExp(`<(${OPERATION_TAG_NAMES})\\b[^>]*\\/>`, 'gi');
  const operationPaired = new RegExp(`<(${OPERATION_TAG_NAMES})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, 'gi');
  const knownTagSweep = new RegExp(`<\\/?(?:${PROTOCOL_TAG_NAMES})\\b[^>]*>`, 'gi');
  const truncatedFragment = new RegExp(`<(?:${PROTOCOL_TAG_NAMES})\\b[^>\\n]*\\s*$`, 'i');
  return text
    .replace(operationSelfClosing, '')
    .replace(operationPaired, '')
    .replace(/<done\b[^>]*>[\s\S]*?<\/done\s*>/gi, '')
    .replace(/<step-done\b[^>]*>[\s\S]*?<\/step-done\s*>/gi, '')
    .replace(/<all-done\b[^>]*>[\s\S]*?<\/all-done\s*>/gi, '')
    .replace(/<\/?confirmed-requirement\b[^>]*>/gi, '')
    .replace(knownTagSweep, '')
    .replace(truncatedFragment, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
        className="rounded-md shadow-2xl overflow-hidden"
        style={{ width: isStreaming ? 720 : 560, maxHeight: '85vh', background: '#ffffff', border: '1px solid var(--color-border-default)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="px-6 py-4 border-b flex items-center gap-3" style={{ borderColor: 'var(--color-border-subtle)' }}>
          {config.icon && <span className="text-2xl">{config.icon}</span>}
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold tracking-wide" style={{ color: 'var(--color-text-primary)' }}>
              {config.label} · <span style={{ color: config.color }}>{node.label}</span>
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
              {isStreaming ? (
                <span>
                  {streamPhase === 'review' ? t('action.reviewerVerifying') : streamRunning ? t('action.agentExecuting') : t('action.execComplete')}
                </span>
              ) : config.description}
            </p>
          </div>
          <button onClick={onClose} disabled={streamRunning}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[rgba(27,42,68,0.045)] transition-colors disabled:opacity-30"
            style={{ color: 'var(--color-text-muted)' }}>
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
                <div className="rounded-md p-3" style={{ background: 'var(--color-bg-layer)', border: '1px solid var(--color-border-default)' }}>
                  <h3 className="text-caption font-medium mb-2 flex items-center gap-2" style={{ color: 'var(--color-text-disabled)' }}>
                    <span>{t('action.toolExecution')}</span>
                    <span className="px-1.5 py-0.5 rounded-sm text-[9px]" style={{ background: 'var(--ibm-layer-02)', color: 'var(--color-text-muted)' }}>
                      {t('action.operations', { count: streamTools.length })}
                    </span>
                  </h3>
                  <div className="flex flex-wrap gap-1">
                    {streamTools.map((tool, i) => {
                      const toolColor = (() => {
                        switch (tool.type) {
                          case 'read_file': case 'list_dir': case 'search': return { bg: 'rgba(53,96,143,.09)', text: '#35608f' };
                          case 'insert_lines': case 'replace_lines': case 'create_file': return { bg: 'rgba(47,125,95,.09)', text: '#2f7d5f' };
                          case 'delete_lines': return { bg: 'rgba(194,69,46,.08)', text: '#c2452e' };
                          case 'run_shell': return { bg: 'rgba(169,123,42,.10)', text: '#a97b2a' };
                          default: return { bg: 'var(--ibm-layer-02)', text: 'var(--color-text-muted)' };
                        }
                      })();
                      return (
                      <span key={i} className="text-[9px] px-2 py-0.5 rounded-sm font-mono"
                        style={{ background: toolColor.bg, color: toolColor.text }}>
                        {tool.type}{tool.file ? `: ${tool.file.split('/').pop()}` : ''}
                      </span>
                    )})}
                  </div>
                </div>
              )}

              {/* Action output */}
              {streamActionOutput && (
                <div className="rounded-md p-4" style={{ background: 'var(--color-bg-layer)', border: '1px solid var(--color-border-default)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: config.color }} />
                    <span className="text-caption font-medium" style={{ color: 'var(--color-text-muted)' }}>{t('action.agentOutput')}</span>
                    {streamRunning && !streamPhase && (
                      <span className="flex items-center gap-1 text-[9px]" style={{ color: 'var(--color-text-disabled)' }}>
                        <span className="inline-block w-1 h-1 rounded-full animate-pulse" style={{ background: 'var(--ibm-success)' }}/>
                        {t('action.running')}
                      </span>
                    )}
                  </div>
                  <MarkdownContent text={streamActionOutput} />
                </div>
              )}

              {/* Review output */}
              {streamReviewOutput && (
                <div className="rounded-md p-4" style={{ background: 'var(--color-bg-layer)', border: '1px solid rgba(194,69,46,.4)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0" style={{ color: 'var(--ibm-error)' }}>
                      <circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>
                    </svg>
                    <span className="text-caption font-medium" style={{ color: 'var(--ibm-error)' }}>{t('action.reviewerVerify')}</span>
                  </div>
                  <MarkdownContent text={streamReviewOutput} />
                </div>
              )}

              {/* Result summary */}
              {streamResult && (
                <div className="rounded-md p-4" style={{
                  background: streamResult.success ? 'rgba(47,125,95,.07)' : 'rgba(194,69,46,.06)',
                  border: `1px solid ${streamResult.review_passed === false ? 'rgba(194,69,46,.4)' : streamResult.success ? 'rgba(47,125,95,.4)' : 'rgba(194,69,46,.4)'}`,
                }}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm">{streamResult.success ? '✓' : '✕'}</span>
                    <span className="text-xs font-semibold" style={{ color: streamResult.success ? 'var(--ibm-success)' : 'var(--ibm-error)' }}>
                      {streamResult.success ? t('action.execComplete') : t('action.execFailed')}
                    </span>
                  </div>
                  {streamResult.message && (
                    <MarkdownContent text={streamResult.message} />
                  )}
                  {streamResult.review_passed !== null && streamResult.review_passed !== undefined && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-caption font-bold px-2 py-0.5 rounded-sm"
                        style={{
                          background: streamResult.review_passed ? 'rgba(47,125,95,.07)' : 'rgba(194,69,46,.06)',
                          border: streamResult.review_passed ? '1px solid rgba(47,125,95,.4)' : '1px solid rgba(194,69,46,.4)',
                          color: streamResult.review_passed ? 'var(--ibm-success)' : 'var(--ibm-error)',
                        }}>
                        {streamResult.review_passed ? 'REVIEW PASSED' : 'REVIEW FAILED'}
                      </span>
                      {streamResult.review_feedback && (
                        <span className="text-caption" style={{ color: 'var(--color-text-muted)' }}>{streamResult.review_feedback}</span>
                      )}
                    </div>
                  )}
                  {streamResult.review_issues?.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {streamResult.review_issues.map((issue: any, j: number) => (
                        <div key={j} className="text-caption flex items-start gap-1.5" style={{ color: 'var(--ibm-error)' }}>
                          <span className="shrink-0 mt-0.5">✕</span>
                          <span>[{issue.severity || '?'}] {issue.file || '?'}: {issue.claim || ''}{issue.reality ? ` → ${issue.reality}` : ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Error */}
              {streamError && (
                <div className="rounded-md p-3" style={{ background: 'rgba(194,69,46,.06)', border: '1px solid rgba(194,69,46,.4)' }}>
                  <span className="text-xs" style={{ color: 'var(--ibm-error)' }}>✕ {streamError}</span>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Node info card — only shown before streaming */}
              <div className="rounded-md p-4" style={{ background: 'rgba(27,42,68,.03)', border: '1px solid var(--color-border-default)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 rounded-sm text-caption font-bold tracking-wider"
                    style={{ background: config.color + '20', color: config.color }}>
                    {node.status === 'problem' ? 'ISSUE' :
                     node.status === 'planned_change' ? 'CHANGE' :
                     node.status === 'planned_new' ? 'NEW' : 'EXISTING'}
                  </span>
                  <span className="text-caption font-mono" style={{ color: 'var(--color-text-disabled)' }}>{node.kind}</span>
                </div>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{node.detail || t('action.noDescription')}</p>
                {node.file && (
                  <div className="mt-2 flex items-center gap-1.5">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ibm-link)" strokeWidth="1.5">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <span className="text-xs font-mono" style={{ color: 'var(--ibm-link)' }}>{node.file}{node.line ? `:${node.line}` : ''}</span>
                  </div>
                )}
              </div>

              {/* Context info — varies by action */}
              {action === 'test' && (
                <div className="rounded-md p-4" style={{ background: 'var(--color-bg-layer)', border: '1px solid var(--color-border-default)' }}>
                  <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('action.testScope')}</h3>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                    {t('action.testContext', { name: node.label })}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-caption" style={{ color: 'var(--color-text-disabled)' }}>{t('action.testTypes')}:</span>
                    {[t('action.unitTest'), t('action.integrationTest'), t('action.e2eTest')].map(label => (
                      <span key={label} className="text-caption px-2 py-0.5 rounded-sm" style={{ background: 'var(--ibm-layer-02)', color: 'var(--color-text-secondary)' }}>{label}</span>
                    ))}
                  </div>
                </div>
              )}

              {action === 'fix' && (
                <div className="rounded-md p-4" style={{ background: 'var(--color-bg-layer)', border: '1px solid var(--color-border-default)' }}>
                  <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('action.fixScope')}</h3>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                    {t('action.fixContext', { name: node.label })}
                  </p>
                </div>
              )}

              {action === 'refactor' && (
                <div className="rounded-md p-4" style={{ background: 'var(--color-bg-layer)', border: '1px solid var(--color-border-default)' }}>
                  <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('action.refactorScope')}</h3>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                    {t('action.refactorContext', { name: node.label })}
                    {downstreamCount > 0 && (
                      <span>{t('action.downstreamCount', { count: downstreamCount })}</span>
                    )}。
                  </p>
                  {downstreamNodes && downstreamNodes.length > 0 && (
                    <div className="mt-3 space-y-1">
                      <span className="text-caption" style={{ color: 'var(--color-text-disabled)' }}>{t('action.affectedNodes')}</span>
                      {downstreamNodes.slice(0, 10).map((n) => (
                        <div key={n.id} className="flex items-center gap-2 text-caption pl-2 py-0.5">
                          <span className="w-1 h-1 rounded-full" style={{ background: config.color }} />
                          <span style={{ color: 'var(--color-text-secondary)' }}>{n.label}</span>
                          {n.file && <span className="font-mono" style={{ color: 'var(--color-text-disabled)' }}>{n.file.split('/').pop()}</span>}
                        </div>
                      ))}
                      {downstreamNodes.length > 10 && (
                        <span className="text-caption" style={{ color: 'var(--color-text-disabled)' }}>{t('action.moreNodes', { count: downstreamNodes.length - 10 })}</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {action === 'explain' && (
                <div className="rounded-md p-4" style={{ background: 'var(--color-bg-layer)', border: '1px solid var(--color-border-default)' }}>
                  <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('action.docGeneration')}</h3>
                  <ul className="space-y-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {[t('action.docItem1'), t('action.docItem2'), t('action.docItem3'), t('action.docItem4'), t('action.docItem5')].map(item => (
                      <li key={item}>· {item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {action === 'develop' && (
                <div className="rounded-md p-4" style={{ background: 'var(--color-bg-layer)', border: '1px solid var(--color-border-default)' }}>
                  <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('action.devTask')}</h3>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
                    {t('action.devContext', { name: node.label })}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    {[t('action.createFiles'), t('action.implFunctions'), t('action.buildCallChain')].map(label => (
                      <span key={label} className="text-caption px-2 py-0.5 rounded-sm" style={{ background: 'var(--ibm-layer-02)', color: 'var(--color-text-secondary)' }}>{label}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Instruction input */}
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--color-text-muted)' }}>
                  {t('action.additionalInstructions')} <span className="font-light" style={{ color: 'var(--color-text-disabled)' }}>{t('action.optional')}</span>
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
                  className="w-full px-3 py-2 rounded-md text-sm bg-transparent resize-none outline-none transition-colors focus:ring-0"
                  style={{
                    background: 'var(--color-bg-surface)',
                    border: '1px solid var(--color-border-default)',
                    color: 'var(--color-text-secondary)',
                    fontFamily: 'var(--ibm-font)',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = config.color; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-default)'; }}
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
                <span className="text-caption" style={{ color: 'var(--color-text-disabled)' }}>{t('action.agentProcessing')}</span>
              ) : streamResult?.review_passed === false ? (
                <span className="text-caption" style={{ color: 'var(--ibm-error)' }}>{t('action.reviewerFailed')}</span>
              ) : (
                <span className="text-caption" style={{ color: 'var(--ibm-success)' }}>{t('action.processingComplete')}</span>
              )}
              <button
                onClick={onClose}
                disabled={streamRunning}
                className="px-4 py-2 rounded-md text-sm font-medium transition-colors hover:bg-[rgba(27,42,68,0.045)] disabled:opacity-30"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {streamRunning ? t('action.processing') : t('common.close')}
              </button>
            </>
          ) : (
            <>
              <span className="text-caption" style={{ color: 'var(--color-text-disabled)' }}>
                {t('action.autoBackup')}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-md text-sm font-medium transition-all hover:bg-[rgba(27,42,68,0.045)] active:scale-[0.98]"
                  style={{ color: 'var(--color-text-muted)' }}
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleConfirm}
                  className="px-5 py-2 rounded-md text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
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
  const cleaned = useMemo(() => cleanProtocolTags(text), [text]);

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
              ? <code className="px-1 py-0.5 rounded-sm text-caption" style={{ background: 'var(--ibm-layer-02)', color: 'var(--color-text-link)' }} {...props}>{children}</code>
              : <code className={className} {...props}>{children}</code>;
          },
          pre: ({ children }: any) => <pre className="code-block" style={{ color: 'var(--color-text-secondary)' }}>{children}</pre>,
          ul: ({ children }: any) => <ul className="list-disc pl-5 mb-1 space-y-0.5" style={{ color: 'var(--color-text-secondary)' }}>{children}</ul>,
          ol: ({ children }: any) => <ol className="list-decimal pl-5 mb-1 space-y-0.5" style={{ color: 'var(--color-text-secondary)' }}>{children}</ol>,
          li: ({ children }: any) => <li className="my-0.5" style={{ color: 'var(--color-text-secondary)' }}>{children}</li>,
          strong: ({ children }: any) => <strong className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{children}</strong>,
          a: ({ href, children }: any) => <a href={href} target="_blank" className="no-underline hover:underline" style={{ color: 'var(--ibm-link)' }}>{children}</a>,
          hr: () => <hr className="my-2" style={{ borderColor: 'var(--color-border-subtle)' }} />,
          blockquote: ({ children }: any) => <blockquote className="border-l-2 pl-2 my-1 italic opacity-70" style={{ borderColor: 'var(--color-border-default)', color: 'var(--color-text-muted)' }}>{children}</blockquote>,
          table: ({ children }: any) => <div className="overflow-x-auto my-2"><table className="w-full text-caption border-separate border-spacing-0">{children}</table></div>,
          th: ({ children }: any) => <th className="border border-subtle bg-layer px-2 py-1 text-caption font-medium" style={{ color: 'var(--color-text-primary)' }}>{children}</th>,
          td: ({ children }: any) => <td className="border border-subtle px-2 py-1 text-caption" style={{ color: 'var(--color-text-secondary)' }}>{children}</td>,
        }}>
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}
