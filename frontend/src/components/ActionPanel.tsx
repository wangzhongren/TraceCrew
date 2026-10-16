import { useState, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { GraphNode } from '../types/graph';
import { getActionConfig, cleanProtocolTags, type ActionType } from './ActionDialog';
import { useT } from '../i18n';

export interface StreamState {
  running: boolean;
  phase: 'action' | 'review' | 'fix' | null;
  timeline: Array<{
    phase: 'action' | 'review' | 'fix';
    output: string;
    tools: Array<{ type: string; file: string }>;
    reviewPassed?: boolean | null;
    reviewFeedback?: string;
    reviewIssues?: Array<{ severity: string; file: string; claim: string; reality: string }>;
  }>;
  result: {
    success?: boolean;
    message?: string;
    review_passed?: boolean | null;
    review_feedback?: string;
    review_issues?: Array<{ severity: string; file: string; claim: string; reality: string }>;
    need_replan?: boolean;
    call_graph?: any;
  } | null;
  error: string | null;
  /** explain 成功完成后讲解 Markdown 落盘的相对路径（.tracecrew/explanations/…）；未导出/落盘失败时为 undefined */
  explainExportPath?: string;
}

export const INITIAL_STREAM_STATE: StreamState = {
  running: false, phase: null, timeline: [], result: null, error: null,
};

interface Props {
  action: ActionType;
  node: GraphNode;
  /**
   * 由 RightPanel 传入。动作收敛为 explain 后本面板不再消费，保留声明以维持
   * RightPanel（应用外壳）既有调用点兼容；其清理需与 app-shell 一并调度。
   */
  downstreamNodes?: GraphNode[];
  onClose: () => void;
  onConfirm: (instruction: string) => Promise<void>;
  onReplan?: () => void;
  stream: StreamState;
}

export default function ActionPanel({
  action, node, onClose, onConfirm, onReplan, stream,
}: Props) {
  const t = useT();
  const [instruction, setInstruction] = useState('');
  const outputRef = useRef<HTMLDivElement>(null);
  const config = getActionConfig(action, t);
  const isStreaming = stream.running || stream.result || stream.error;

  // Auto-scroll streaming output
  useEffect(() => {
    if (isStreaming && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [stream.timeline, isStreaming]);

  const handleConfirm = () => {
    onConfirm(instruction);
  };

  // Header status text for the streaming panel: the review phase has its own
  // label; an active fix or any running action shows the executing label.
  let phaseLabel = t('action.execComplete');
  if (stream.phase === 'review') {
    phaseLabel = t('action.reviewerVerifying');
  } else if (stream.phase === 'fix' || stream.running) {
    phaseLabel = t('action.agentExecuting');
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg-primary)' }}>
      {/* ── Header ── */}
      <div className="shrink-0 px-4 py-2.5 border-t flex items-center gap-2" style={{ borderColor: 'var(--color-border-default)' }}>
        {config.icon && <span className="text-base">{config.icon}</span>}
        <div className="flex-1 min-w-0">
          <h3 className="text-xs font-semibold tracking-wide truncate" style={{ color: 'var(--color-text-primary)' }}>
            {config.label} · <span style={{ color: config.color }}>{node.label}</span>
          </h3>
          <p className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--color-text-muted)' }}>
            {isStreaming ? (
              <span>
                {phaseLabel}
              </span>
            ) : config.description}
          </p>
        </div>
        <button onClick={onClose} disabled={stream.running}
          className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-[rgba(27,42,68,0.045)] transition-colors disabled:opacity-30 shrink-0"
          style={{ color: 'var(--color-text-muted)' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      {/* ── Body (scrollable) ── */}
      <div ref={outputRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
        {isStreaming ? (
          <>
            {/* Phase timeline */}
            {stream.timeline.map((entry, idx) => {
              const isCurrent = idx === stream.timeline.length - 1 && stream.running;
              const phaseConfig = getPhaseConfig(entry.phase, t);
              return (
                <PhaseSection
                  key={idx}
                  entry={entry}
                  phaseConfig={phaseConfig}
                  isCurrent={isCurrent}
                  t={t}
                />
              );
            })}

            {/* Result summary */}
            {stream.result && (
              <div className="rounded-md p-3" style={{
                background: stream.result.success ? 'rgba(47,125,95,.07)' : 'rgba(194,69,46,.06)',
                border: `1px solid ${stream.result.review_passed === false ? 'rgba(194,69,46,.4)' : stream.result.success ? 'rgba(47,125,95,.4)' : 'rgba(194,69,46,.4)'}`,
              }}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs">{stream.result.success ? '✓' : '✕'}</span>
                  <span className="text-[10px] font-semibold" style={{ color: stream.result.success ? 'var(--ibm-success)' : 'var(--ibm-error)' }}>
                    {stream.result.success ? t('action.execComplete') : t('action.execFailed')}
                  </span>
                </div>
                {stream.result.message && <MarkdownContent text={stream.result.message} />}
                {stream.result.success && stream.explainExportPath && (
                  <div className="mt-1.5 text-[9px]" style={{ color: 'var(--color-text-muted)' }}>
                    {t('action.explainExported', { path: stream.explainExportPath })}
                  </div>
                )}
                {stream.result.review_passed !== null && stream.result.review_passed !== undefined && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-sm"
                      style={{
                        background: stream.result.review_passed ? 'rgba(47,125,95,.07)' : 'rgba(194,69,46,.06)',
                        border: stream.result.review_passed ? '1px solid rgba(47,125,95,.4)' : '1px solid rgba(194,69,46,.4)',
                        color: stream.result.review_passed ? 'var(--ibm-success)' : 'var(--ibm-error)',
                      }}>
                      {stream.result.review_passed ? 'REVIEW PASSED' : 'REVIEW FAILED'}
                    </span>
                    {stream.result.review_feedback && (
                      <span className="text-[9px]" style={{ color: 'var(--color-text-muted)' }}>{stream.result.review_feedback}</span>
                    )}
                  </div>
                )}
                {(stream.result.review_issues?.length ?? 0) > 0 && (
                  <div className="mt-2 space-y-1">
                    {stream.result.review_issues!.map((issue: any, j: number) => (
                      <div key={j} className="text-[9px] flex items-start gap-1.5" style={{ color: 'var(--ibm-error)' }}>
                        <span className="shrink-0 mt-0.5">✕</span>
                        <span>[{issue.severity || '?'}] {issue.file || '?'}: {issue.claim || ''}{issue.reality ? ` → ${issue.reality}` : ''}</span>
                      </div>
                    ))}
                  </div>
                )}
                {stream.result.need_replan && onReplan && (
                  <button
                    onClick={onReplan}
                    className="mt-3 w-full text-[10px] font-semibold px-3 py-1.5 rounded-md transition-colors flex items-center justify-center gap-1.5"
                    style={{ background: 'rgba(169,123,42,.10)', border: '1px solid rgba(169,123,42,.4)', color: 'var(--ibm-warning)' }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                    </svg>
                    {t('action.replan')}
                  </button>
                )}
              </div>
            )}

            {/* Error */}
            {stream.error && (
              <div className="rounded-md p-2.5" style={{ background: 'rgba(194,69,46,.06)', border: '1px solid rgba(194,69,46,.4)' }}>
                <span className="text-[10px]" style={{ color: 'var(--ibm-error)' }}>✕ {stream.error}</span>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Compact node info */}
            <div className="rounded-md p-3" style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-default)' }}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="px-1.5 py-0.5 rounded-sm text-[9px] font-bold tracking-wider"
                  style={{ background: config.color + '18', color: config.color }}>
                  {node.status === 'problem' ? 'ISSUE' :
                   node.status === 'planned_change' ? 'CHANGE' :
                   node.status === 'planned_new' ? 'NEW' : 'EXISTING'}
                </span>
                {node.kind && <span className="text-[9px] font-mono" style={{ color: 'var(--color-text-disabled)' }}>{node.kind}</span>}
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{node.detail || t('action.noDescription')}</p>
              {node.file && (
                <div className="mt-1.5 flex items-center gap-1">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--ibm-link)" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                  <span className="text-[10px] font-mono" style={{ color: 'var(--ibm-link)' }}>{node.file}{node.line ? `:${node.line}` : ''}</span>
                </div>
              )}
            </div>

            {/* Bug impact scope — for problem nodes */}
            {node.impact_scope && (() => {
              const is = node.impact_scope;
              return (
                <div className="rounded-md p-3 space-y-2" style={{ background: 'rgba(169,123,42,.07)', border: '1px solid rgba(169,123,42,.4)' }}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold" style={{ color: 'var(--ibm-warning)' }}>Bug 影响范围</span>
                  </div>
                  {is.root_cause && (
                    <div className="text-[10px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                      <span className="font-semibold">根因：</span>{is.root_cause}
                    </div>
                  )}
                  {is.trigger_path?.length > 0 && (
                    <div className="flex items-start gap-1">
                      <span className="text-[10px] font-semibold shrink-0" style={{ color: 'var(--ibm-warning)' }}>触发路径：</span>
                      <div className="flex flex-wrap items-center gap-0.5">
                        {is.trigger_path.map((nid, i) => (
                          <span key={nid} className="flex items-center gap-0.5">
                            {i > 0 && <span className="text-[9px]" style={{ color: 'var(--ibm-warning)' }}>→</span>}
                            <code className="text-[9px] px-1 py-px rounded-sm" style={{ background: 'rgba(169,123,42,.10)', color: 'var(--ibm-warning)' }}>{nid}</code>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {is.affected_nodes?.length > 0 && (
                    <div className="flex items-start gap-1">
                      <span className="text-[10px] font-semibold shrink-0" style={{ color: 'var(--ibm-warning)' }}>影响节点：</span>
                      <div className="flex flex-wrap gap-1">
                        {is.affected_nodes.map(nid => (
                          <code key={nid} className="text-[9px] px-1 py-px rounded-sm" style={{ background: 'rgba(169,123,42,.10)', color: 'var(--ibm-warning)' }}>{nid}</code>
                        ))}
                      </div>
                    </div>
                  )}
                  {is.fix_files?.length > 0 && (
                    <div className="flex items-start gap-1">
                      <span className="text-[10px] font-semibold shrink-0" style={{ color: 'var(--ibm-warning)' }}>涉及文件：</span>
                      <div className="flex flex-wrap gap-1">
                        {is.fix_files.map(f => (
                          <code key={f} className="text-[9px] px-1 py-px rounded-sm" style={{ background: 'rgba(194,69,46,.07)', color: 'var(--ibm-error)' }}>{f}</code>
                        ))}
                      </div>
                    </div>
                  )}
                  {is.verification && (
                    <div className="text-[10px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                      <span className="font-semibold">验证：</span>{is.verification}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Sub-components — for planned_new nodes */}
            {node.sub_components && node.sub_components.length > 0 && (
              <div className="rounded-md p-3 space-y-1.5" style={{ background: 'rgba(47,125,95,.07)', border: '1px solid rgba(47,125,95,.4)' }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] font-bold" style={{ color: 'var(--ibm-success)' }}>组件清单</span>
                  <span className="text-[9px]" style={{ color: 'var(--ibm-success)' }}>({node.sub_components.length})</span>
                </div>
                {node.sub_components.map((sc: any) => {
                  const catLabels: Record<string, string> = { widget: '控件', service: '服务', model: '模型', hook: 'Hook', util: '工具', layout: '布局' };
                  const catColors: Record<string, string> = { widget: '#35608f', service: '#2f7d5f', model: '#6b5b95', hook: '#a97b2a', util: '#5e7089', layout: '#3c7d8f' };
                  const cc = catColors[sc.category] || '#8593aa';
                  return (
                    <div key={sc.id} className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: cc }} />
                      <span className="font-medium">{sc.label}</span>
                      <span className="px-1 py-px rounded-sm text-[8px] font-bold tracking-wider" style={{ background: cc + '18', color: cc }}>
                        {catLabels[sc.category] || sc.category}
                      </span>
                      {sc.widget_type && (
                        <code className="text-[9px] px-1 py-px rounded-sm" style={{ background: 'rgba(53,96,143,.09)', color: '#35608f' }}>{sc.widget_type}</code>
                      )}
                      {sc.props && (
                        <span className="text-[9px] opacity-50 truncate">{sc.props}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Context info — 解释动作的产出说明卡 */}
            <ActionContext t={t} />

            {/* Instruction input */}
            <div>
              <label className="text-[10px] font-medium mb-1 block" style={{ color: 'var(--color-text-muted)' }}>
                {t('action.additionalInstructions')} <span className="font-light" style={{ color: 'var(--color-text-disabled)' }}>{t('action.optional')}</span>
              </label>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder={t('action.explainPlaceholder')}
                rows={2}
                className="w-full px-3 py-2 rounded-md text-xs bg-transparent resize-none outline-none transition-colors focus:ring-0"
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
      <div className="shrink-0 px-4 py-2.5 border-t flex items-center justify-between" style={{ borderColor: 'var(--color-border-subtle)' }}>
        {isStreaming ? (
          <>
            {stream.running ? (
              <span className="text-[9px]" style={{ color: 'var(--color-text-disabled)' }}>{t('action.agentProcessing')}</span>
            ) : stream.result?.review_passed === false ? (
              <span className="text-[9px]" style={{ color: 'var(--ibm-error)' }}>{t('action.reviewerFailedShort')}</span>
            ) : (
              <span className="text-[9px]" style={{ color: 'var(--ibm-success)' }}>{t('action.processingCompleteShort')}</span>
            )}
            <button onClick={onClose} disabled={stream.running}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:bg-[rgba(27,42,68,0.045)] disabled:opacity-30"
              style={{ color: 'var(--color-text-muted)' }}>
              {stream.running ? t('action.processing') : t('common.close')}
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 ml-auto">
              <button onClick={onClose}
                className="px-3 py-1.5 rounded-md text-xs font-medium transition-all hover:bg-[rgba(27,42,68,0.045)] active:scale-[0.98]"
                style={{ color: 'var(--color-text-muted)' }}>
                {t('common.cancel')}
              </button>
              <button onClick={handleConfirm}
                className="px-4 py-1.5 rounded-md text-xs font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
                style={{ background: config.color, color: '#fff' }}>
                {t('action.startAction', { label: config.label })}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Phase section — collapsible card for each timeline entry ── */

function getPhaseConfig(phase: string, t: (k: string) => string) {
  switch (phase) {
    case 'action':  return { label: t('action.agentExecuting'), borderColor: 'var(--color-border-default)' };
    case 'review':  return { label: t('action.reviewerVerifying'), borderColor: 'rgba(194,69,46,.4)' };
    case 'fix':     return { label: t('action.agentExecuting'), borderColor: 'rgba(169,123,42,.4)' };
    default:        return { label: phase, borderColor: 'var(--color-border-default)' };
  }
}

/* ── Phase header glyphs (line icons, emoji out of chrome) ── */

function PhaseGlyph({ phase }: { phase: string }) {
  if (phase === 'review') {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0">
        <circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>
      </svg>
    );
  }
  if (phase === 'fix') {
    return (
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
      </svg>
    );
  }
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0">
      <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>
    </svg>
  );
}

function PhaseSection({ entry, phaseConfig, isCurrent, t }: {
  entry: StreamState['timeline'][0];
  phaseConfig: ReturnType<typeof getPhaseConfig>;
  isCurrent: boolean;
  t: (k: string, v?: Record<string, string | number>) => string;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasContent = entry.output.trim().length > 0 || entry.tools.length > 0;

  if (!hasContent && !isCurrent) return null;

  return (
    <div className="rounded-md overflow-hidden" style={{ border: `1px solid ${phaseConfig.borderColor}` }}>
      {/* Phase header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[rgba(27,42,68,0.03)]"
        style={{ background: 'var(--color-bg-layer)' }}>
        <span className="text-[11px] flex items-center" style={{ color: 'var(--color-text-muted)' }}><PhaseGlyph phase={entry.phase} /></span>
        <span className="text-[10px] font-medium flex-1" style={{ color: 'var(--color-text-secondary)' }}>
          {phaseConfig.label}
        </span>
        {isCurrent && (
          <span className="flex items-center gap-1 text-[9px]" style={{ color: 'var(--color-text-disabled)' }}>
            <span className="inline-block w-1 h-1 rounded-full animate-pulse" style={{ background: 'var(--ibm-success)' }}/>
            {t('action.running')}
          </span>
        )}
        {entry.tools.length > 0 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-sm inline-flex items-center gap-1" style={{ background: 'var(--ibm-layer-02)', color: 'var(--color-text-muted)' }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
            </svg>
            {entry.tools.length}
          </span>
        )}
        <svg width="8" height="8" viewBox="0 0 8 8" className="shrink-0"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s', color: 'var(--color-text-disabled)' }}>
          <path d="M2 3 L4 5 L6 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>

      {/* Expandable content */}
      {expanded && (
        <div className="px-3 py-2" style={{ background: 'var(--color-bg-primary)' }}>
          {/* Tool badges */}
          {entry.tools.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {entry.tools.map((tool: { type: string; file: string }, i: number) => {
                const toolColor = getToolColor(tool.type);
                return (
                  <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-sm font-mono"
                    style={{ background: toolColor.bg, color: toolColor.text }}>
                    {tool.type}{tool.file ? `: ${tool.file.split('/').pop()}` : ''}
                  </span>
                );
              })}
            </div>
          )}
          {/* Output text */}
          {entry.output && <MarkdownContent text={entry.output} />}
        </div>
      )}
    </div>
  );
}

/* ── Action-specific context info（动作收敛：仅「解释」卡） ── */

function ActionContext({ t }: {
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <div className="rounded-md p-3" style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-default)' }}>
      <ul className="space-y-0.5 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
        {[t('action.docItem1'), t('action.docItem2'), t('action.docItem3'), t('action.docItem4'), t('action.docItem5')].map(item => (
          <li key={item}>· {item}</li>
        ))}
      </ul>
    </div>
  );
}

/* ── Helpers ── */

function getToolColor(type: string): { bg: string; text: string } {
  switch (type) {
    case 'read_file': case 'list_dir': case 'search': return { bg: 'rgba(53,96,143,.09)', text: '#35608f' };
    case 'insert_lines': case 'replace_lines': case 'create_file': return { bg: 'rgba(47,125,95,.09)', text: '#2f7d5f' };
    case 'delete_lines': return { bg: 'rgba(194,69,46,.08)', text: '#c2452e' };
    case 'run_shell': return { bg: 'rgba(169,123,42,.10)', text: '#a97b2a' };
    default: return { bg: 'var(--ibm-layer-02)', text: 'var(--color-text-secondary)' };
  }
}

/* ── Inline Markdown renderer ── */

function MarkdownContent({ text }: { text: string }) {
  const cleaned = useMemo(() => cleanProtocolTags(text), [text]);

  if (!cleaned) return null;
  return (
    <div className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }: any) => <h1 className="text-xs font-semibold mt-2 mb-1" style={{ color: 'var(--color-text-primary)' }}>{children}</h1>,
          h2: ({ children }: any) => <h2 className="text-[11px] font-semibold mt-2 mb-1" style={{ color: 'var(--color-text-primary)' }}>{children}</h2>,
          h3: ({ children }: any) => <h3 className="text-[10px] font-semibold mt-1.5 mb-0.5" style={{ color: 'var(--color-text-primary)' }}>{children}</h3>,
          p: ({ children }: any) => <p className="my-0.5 last:mb-0">{children}</p>,
          code: ({ className, children, ...props }: any) => {
            const inline = !className;
            return inline
              ? <code className="px-1 py-0.5 rounded-sm text-[9px]" style={{ background: 'var(--ibm-layer-02)', color: 'var(--color-text-link)' }} {...props}>{children}</code>
              : <code className={className} {...props}>{children}</code>;
          },
          pre: ({ children }: any) => <pre className="code-block">{children}</pre>,
          ul: ({ children }: any) => <ul className="list-disc pl-4 mb-1 space-y-0.5">{children}</ul>,
          ol: ({ children }: any) => <ol className="list-decimal pl-4 mb-1 space-y-0.5">{children}</ol>,
          li: ({ children }: any) => <li className="my-0.5">{children}</li>,
          strong: ({ children }: any) => <strong className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{children}</strong>,
          a: ({ href, children }: any) => <a href={href} target="_blank" className="no-underline hover:underline" style={{ color: 'var(--ibm-link)' }}>{children}</a>,
          hr: () => <hr className="my-1.5" style={{ borderColor: 'var(--color-border-subtle)' }} />,
          blockquote: ({ children }: any) => <blockquote className="border-l-2 pl-2 my-1 italic opacity-70" style={{ borderColor: 'var(--color-border-default)' }}>{children}</blockquote>,
        }}>
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}
