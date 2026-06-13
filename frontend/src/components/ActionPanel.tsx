import { useState, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { GraphNode } from './MapCanvas';
import { ACTION_CONFIGS, type ActionType } from './ActionDialog';

export interface StreamState {
  running: boolean;
  phase: 'action' | 'review' | null;
  actionOutput: string;
  reviewOutput: string;
  tools: Array<{ type: string; file: string }>;
  result: {
    success?: boolean;
    message?: string;
    review_passed?: boolean | null;
    review_feedback?: string;
    review_issues?: Array<{ severity: string; file: string; claim: string; reality: string }>;
    call_graph?: any;
  } | null;
  reviewRequired: boolean;
  error: string | null;
}

export const INITIAL_STREAM_STATE: StreamState = {
  running: false, phase: null, actionOutput: '', reviewOutput: '', tools: [], result: null, reviewRequired: false, error: null,
};

interface Props {
  action: ActionType;
  node: GraphNode;
  downstreamNodes?: GraphNode[];
  onClose: () => void;
  onConfirm: (instruction: string) => Promise<void>;
  stream: StreamState;
}

export default function ActionPanel({
  action, node, downstreamNodes, onClose, onConfirm, stream,
}: Props) {
  const [instruction, setInstruction] = useState('');
  const outputRef = useRef<HTMLDivElement>(null);
  const config = ACTION_CONFIGS[action];
  const isStreaming = stream.running || stream.result || stream.error;

  // Auto-scroll streaming output
  useEffect(() => {
    if (isStreaming && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [stream.actionOutput, stream.reviewOutput, isStreaming]);

  const handleConfirm = () => {
    onConfirm(instruction);
  };

  const downstreamCount = downstreamNodes?.length || 0;

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg-primary)' }}>
      {/* ── Header ── */}
      <div className="shrink-0 px-4 py-2.5 border-t flex items-center gap-2" style={{ borderColor: 'var(--color-border-default)' }}>
        <span className="text-base">{config.icon}</span>
        <div className="flex-1 min-w-0">
          <h3 className="text-xs font-semibold tracking-wide truncate" style={{ color: 'var(--color-text-primary)' }}>
            {config.label} · <span style={{ color: config.color }}>{node.label}</span>
          </h3>
          <p className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--color-text-muted)' }}>
            {isStreaming ? (
              <span>
                {stream.phase === 'review' ? '🔍 Reviewer 验收中...' : stream.running ? '⏳ Agent 正在执行...' : '✅ 执行完成'}
              </span>
            ) : config.description}
          </p>
        </div>
        <button onClick={onClose} disabled={stream.running}
          className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-black/[0.03] transition-colors disabled:opacity-30 shrink-0"
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
            {/* Tools executed */}
            {stream.tools && stream.tools.length > 0 && (
              <div className="rounded-lg p-2.5" style={{ background: 'var(--color-bg-layer)', border: '1px solid var(--color-border-subtle)' }}>
                <h4 className="text-[10px] font-medium mb-1.5 flex items-center gap-2" style={{ color: 'var(--color-text-disabled)' }}>
                  <span>🔧 工具执行</span>
                  <span className="px-1.5 py-0.5 rounded text-[9px]" style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text-muted)' }}>
                    {stream.tools.length} 个操作
                  </span>
                </h4>
                <div className="flex flex-wrap gap-1">
                  {stream.tools.map((t, i) => {
                    const toolColor = getToolColor(t.type);
                    return (
                      <span key={i} className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                        style={{ background: toolColor.bg, color: toolColor.text }}>
                        {t.type}{t.file ? `: ${t.file.split('/').pop()}` : ''}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Action output */}
            {stream.actionOutput && (
              <div className="rounded-lg p-3" style={{ background: 'var(--color-bg-layer)', border: '1px solid var(--color-border-subtle)' }}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: config.color }} />
                  <span className="text-[10px] font-medium" style={{ color: 'var(--color-text-muted)' }}>Agent 输出</span>
                  {stream.running && !stream.phase && (
                    <span className="flex items-center gap-1 text-[9px]" style={{ color: 'var(--color-text-disabled)' }}>
                      <span className="inline-block w-1 h-1 rounded-full animate-pulse" style={{ background: '#22c55e' }}/>
                      运行中...
                    </span>
                  )}
                </div>
                <MarkdownContent text={stream.actionOutput} />
              </div>
            )}

            {/* Review output */}
            {stream.reviewOutput && (
              <div className="rounded-lg p-3" style={{ background: 'var(--color-bg-layer)', border: '1px solid #fecaca' }}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[10px]">🔍</span>
                  <span className="text-[10px] font-medium" style={{ color: '#dc2626' }}>Reviewer 验收</span>
                </div>
                <MarkdownContent text={stream.reviewOutput} />
              </div>
            )}

            {/* Result summary */}
            {stream.result && (
              <div className="rounded-lg p-3" style={{
                background: stream.result.success ? '#f0fdf4' : '#fef2f2',
                border: `1px solid ${stream.result.review_passed === false ? '#fecaca' : stream.result.success ? '#bbf7d0' : '#fecaca'}`,
              }}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs">{stream.result.success ? '✅' : '❌'}</span>
                  <span className="text-[10px] font-semibold" style={{ color: stream.result.success ? '#22c55e' : '#ff4444' }}>
                    {stream.result.success ? '执行完成' : '执行失败'}
                  </span>
                </div>
                {stream.result.message && <MarkdownContent text={stream.result.message} />}
                {stream.result.review_passed !== null && stream.result.review_passed !== undefined && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded"
                      style={{
                        background: stream.result.review_passed ? '#dcfce7' : '#fee2e2',
                        color: stream.result.review_passed ? '#16a34a' : '#dc2626',
                      }}>
                      {stream.result.review_passed ? 'REVIEW PASSED' : 'REVIEW FAILED'}
                    </span>
                    {stream.result.review_feedback && (
                      <span className="text-[9px]" style={{ color: 'var(--color-text-muted)' }}>{stream.result.review_feedback}</span>
                    )}
                  </div>
                )}
                {stream.result.review_issues?.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {stream.result.review_issues.map((issue: any, j: number) => (
                      <div key={j} className="text-[9px] flex items-start gap-1.5" style={{ color: '#ff4444' }}>
                        <span className="shrink-0 mt-0.5">⚠</span>
                        <span>[{issue.severity || '?'}] {issue.file || '?'}: {issue.claim || ''}{issue.reality ? ` → ${issue.reality}` : ''}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Error */}
            {stream.error && (
              <div className="rounded-lg p-2.5" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                <span className="text-[10px]" style={{ color: '#ff4444' }}>❌ {stream.error}</span>
              </div>
            )}
          </>
        ) : (
          <>
            {/* Compact node info */}
            <div className="rounded-lg p-3" style={{ background: 'var(--color-bg-layer)', border: '1px solid var(--color-border-subtle)' }}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider"
                  style={{ background: config.color + '18', color: config.color }}>
                  {node.status === 'problem' ? 'ISSUE' :
                   node.status === 'planned_change' ? 'CHANGE' :
                   node.status === 'planned_new' ? 'NEW' : 'EXISTING'}
                </span>
                {node.kind && <span className="text-[9px] font-mono" style={{ color: 'var(--color-text-disabled)' }}>{node.kind}</span>}
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{node.detail || '无详细描述'}</p>
              {node.file && (
                <div className="mt-1.5 flex items-center gap-1">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                  <span className="text-[10px] font-mono" style={{ color: '#3b82f6' }}>{node.file}{node.line ? `:${node.line}` : ''}</span>
                </div>
              )}
            </div>

            {/* Context info — varies by action */}
            <ActionContext action={action} node={node} config={config} downstreamNodes={downstreamNodes} downstreamCount={downstreamCount} />

            {/* Instruction input */}
            <div>
              <label className="text-[10px] font-medium mb-1 block" style={{ color: 'var(--color-text-muted)' }}>
                补充说明 <span className="font-light" style={{ color: 'var(--color-text-disabled)' }}>（可选）</span>
              </label>
              <textarea
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder={getPlaceholder(action)}
                rows={2}
                className="w-full px-3 py-2 rounded-lg text-xs bg-transparent resize-none outline-none transition-colors focus:ring-1"
                style={{
                  background: 'var(--color-bg-layer)',
                  border: '1px solid var(--color-border-subtle)',
                  color: 'var(--color-text-secondary)',
                  fontFamily: 'var(--ibm-font)',
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = config.color; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border-subtle)'; }}
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
              <span className="text-[9px]" style={{ color: 'var(--color-text-disabled)' }}>⏳ Agent 正在处理...</span>
            ) : stream.result?.review_passed === false ? (
              <span className="text-[9px]" style={{ color: '#ff4444' }}>❌ Reviewer 未通过</span>
            ) : (
              <span className="text-[9px]" style={{ color: '#22c55e' }}>✅ 处理完成</span>
            )}
            <button onClick={onClose} disabled={stream.running}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors hover:bg-black/[0.03] disabled:opacity-30"
              style={{ color: 'var(--color-text-muted)' }}>
              {stream.running ? '处理中...' : '关闭'}
            </button>
          </>
        ) : (
          <>
            <span className="text-[9px]" style={{ color: 'var(--color-text-disabled)' }}>
              修改前自动备份
            </span>
            <div className="flex items-center gap-2">
              <button onClick={onClose}
                className="px-3 py-1.5 rounded-md text-xs font-medium transition-all hover:bg-black/[0.03] active:scale-[0.98]"
                style={{ color: 'var(--color-text-muted)' }}>
                取消
              </button>
              <button onClick={handleConfirm}
                className="px-4 py-1.5 rounded-md text-xs font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
                style={{ background: config.color, color: '#fff' }}>
                开始{config.label}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Action-specific context info ── */

function ActionContext({ action, node, config, downstreamNodes, downstreamCount }: {
  action: ActionType; node: GraphNode; config: typeof ACTION_CONFIGS[ActionType];
  downstreamNodes?: GraphNode[]; downstreamCount: number;
}) {
  switch (action) {
    case 'fix':
      return (
        <div className="rounded-lg p-3" style={{ background: 'var(--color-bg-layer)', border: '1px solid var(--color-border-subtle)' }}>
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
            仅修复 <span style={{ color: config.color, fontWeight: 600 }}>{node.label}</span> 节点的问题。
          </p>
        </div>
      );
    case 'test':
      return (
        <div className="rounded-lg p-3" style={{ background: 'var(--color-bg-layer)', border: '1px solid var(--color-border-subtle)' }}>
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
            将对 <span style={{ color: config.color, fontWeight: 600 }}>{node.label}</span> 及其关联链路执行完整测试。
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            {['单元测试', '集成测试', '端到端'].map(t => (
              <span key={t} className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text-secondary)' }}>{t}</span>
            ))}
          </div>
        </div>
      );
    case 'refactor':
      return (
        <div className="rounded-lg p-3" style={{ background: 'var(--color-bg-layer)', border: '1px solid var(--color-border-subtle)' }}>
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
            以 <span style={{ color: config.color, fontWeight: 600 }}>{node.label}</span> 为起点，重构该节点及其所有下游节点
            {downstreamCount > 0 && <span>（共 <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{downstreamCount}</span> 个）</span>}。
          </p>
          {downstreamNodes && downstreamNodes.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {downstreamNodes.slice(0, 8).map((n) => (
                <div key={n.id} className="flex items-center gap-1.5 text-[9px] pl-1.5 py-0.5">
                  <span className="w-1 h-1 rounded-full" style={{ background: config.color }} />
                  <span style={{ color: 'var(--color-text-secondary)' }}>{n.label}</span>
                  {n.file && <span className="font-mono" style={{ color: 'var(--color-text-disabled)' }}>{n.file.split('/').pop()}</span>}
                </div>
              ))}
              {downstreamNodes.length > 8 && (
                <span className="text-[9px]" style={{ color: 'var(--color-text-disabled)' }}>...还有 {downstreamNodes.length - 8} 个</span>
              )}
            </div>
          )}
        </div>
      );
    case 'explain':
      return (
        <div className="rounded-lg p-3" style={{ background: 'var(--color-bg-layer)', border: '1px solid var(--color-border-subtle)' }}>
          <ul className="space-y-0.5 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
            {['功能概述与业务逻辑', '调用链路与数据流图', '关键函数签名与参数说明', '上下游依赖关系', '边界情况与注意事项'].map(item => (
              <li key={item}>· {item}</li>
            ))}
          </ul>
        </div>
      );
    case 'develop':
      return (
        <div className="rounded-lg p-3" style={{ background: 'var(--color-bg-layer)', border: '1px solid var(--color-border-subtle)' }}>
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
            完成 <span style={{ color: config.color, fontWeight: 600 }}>{node.label}</span> 新功能的开发。
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            {['新建文件', '实现函数', '建立调用链'].map(t => (
              <span key={t} className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-bg-alt)', color: 'var(--color-text-secondary)' }}>{t}</span>
            ))}
          </div>
        </div>
      );
    default:
      return null;
  }
}

/* ── Helpers ── */

function getPlaceholder(action: ActionType): string {
  switch (action) {
    case 'test': return '指定测试范围或测试策略...';
    case 'fix': return '描述已知的问题原因或修复方向...';
    case 'refactor': return '描述重构目标和期望的架构方向...';
    case 'explain': return '指定文档侧重点或需要强调的内容...';
    case 'develop': return '描述功能需求和技术约束...';
    default: return '输入补充说明...';
  }
}

function getToolColor(type: string): { bg: string; text: string } {
  switch (type) {
    case 'read_file': case 'list_dir': case 'search': return { bg: '#dbeafe', text: '#2563eb' };
    case 'insert_lines': case 'replace_lines': case 'create_file': return { bg: '#dcfce7', text: '#16a34a' };
    case 'delete_lines': return { bg: '#fee2e2', text: '#dc2626' };
    case 'run_shell': return { bg: '#fef3c7', text: '#b45309' };
    default: return { bg: '#f0f1f3', text: 'var(--color-text-secondary)' };
  }
}

/* ── Inline Markdown renderer ── */

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
              ? <code className="px-1 py-0.5 rounded text-[9px]" style={{ background: '#f0f1f3', color: 'var(--color-text-link)' }} {...props}>{children}</code>
              : <code className={className} {...props}>{children}</code>;
          },
          pre: ({ children }: any) => <pre className="code-block">{children}</pre>,
          ul: ({ children }: any) => <ul className="list-disc pl-4 mb-1 space-y-0.5">{children}</ul>,
          ol: ({ children }: any) => <ol className="list-decimal pl-4 mb-1 space-y-0.5">{children}</ol>,
          li: ({ children }: any) => <li className="my-0.5">{children}</li>,
          strong: ({ children }: any) => <strong className="font-semibold" style={{ color: 'var(--color-text-primary)' }}>{children}</strong>,
          a: ({ href, children }: any) => <a href={href} target="_blank" className="no-underline hover:underline" style={{ color: '#3b82f6' }}>{children}</a>,
          hr: () => <hr className="my-1.5" style={{ borderColor: 'var(--color-border-subtle)' }} />,
          blockquote: ({ children }: any) => <blockquote className="border-l-2 pl-2 my-1 italic opacity-70" style={{ borderColor: 'var(--color-border-default)' }}>{children}</blockquote>,
        }}>
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}
