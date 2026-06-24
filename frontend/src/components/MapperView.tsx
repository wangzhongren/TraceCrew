import { useState, useMemo, useEffect } from 'react';
import type { CallGraph } from './MapCanvas';
import { getActionsForNode, ACTION_CONFIGS } from './ActionDialog';
import type { ActionType } from './ActionDialog';
import { STATUS_COLORS_SIMPLE, STATUS_LABELS } from '../types/theme';
import type { NodeStatus } from '../types/theme';
import { useT } from '../i18n';

interface Props {
  graph: CallGraph | null;
  phase: 'idle' | 'planning' | 'executing' | 'reviewing' | 'done' | 'rejected';
  onSelectNode: (id: string | null) => void;
  onGraphChange?: (graph: CallGraph) => void;
  selectedNode: string | null;
  projectPath: string | null;
  activeAction: ActionType | null;
  onRequestAction: (action: ActionType) => void;
  streamRunning: boolean;
  /** Start auto-executing all pending tasks in dependency order */
  onAutoExec?: () => void;
  /** Stop the currently running auto-exec */
  onStopAutoExec?: () => void;
  /** Whether auto-exec is currently running */
  autoExecRunning?: boolean;
  /** Auto-exec progress */
  autoExecProgress?: { current: number; total: number; currentNodeId: string | null } | null;
  /** Per-node execution records for card expand */
  execRecords?: Record<string, { summary: string; review_passed: boolean | null; review_feedback?: string; review_issues?: any[] }>;
  /** Live streaming output for currently executing node */
  liveOutput?: Record<string, string>;
}

/* ── Helpers ── */

type ColumnKey = 'pending' | 'active' | 'done';

function classifyNode(status: string, isActive: boolean): ColumnKey {
  if (isActive) return 'active';
  if (status === 'done' || status === 'existing') return 'done';
  return 'pending';
}

/* ── KanbanBoard ── */

function KanbanBoard({ graph, onSelect, selectedNode: sel, onRequestAction, streamRunning, onAutoExec, onStopAutoExec, autoExecRunning, autoExecProgress, execRecords, liveOutput }: {
  graph: CallGraph;
  onSelect: (id: string) => void;
  selectedNode: string | null;
  onRequestAction: (action: ActionType) => void;
  streamRunning: boolean;
  onAutoExec?: () => void;
  onStopAutoExec?: () => void;
  autoExecRunning?: boolean;
  autoExecProgress?: { current: number; total: number; currentNodeId: string | null } | null;
  execRecords?: Record<string, { summary: string; review_passed: boolean | null; review_feedback?: string; review_issues?: any[] }>;
  liveOutput?: Record<string, string>;
}) {
  const t = useT();
  const [filter, setFilter] = useState<string>('all');
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  // Auto-expand the active node's card
  useEffect(() => {
    const activeId = autoExecProgress?.currentNodeId || (streamRunning ? sel : null);
    if (activeId) {
      setExpandedCards(prev => {
        if (prev.has(activeId)) return prev;
        const s = new Set(prev);
        s.add(activeId);
        return s;
      });
    }
  }, [autoExecProgress?.currentNodeId, streamRunning, sel]);

  // Compute which node is "active" (currently being worked on)
  const activeNodeId = autoExecProgress?.currentNodeId
    || (streamRunning ? sel : null);

  // Partition nodes into columns
  const columns = useMemo(() => {
    const result: Record<ColumnKey, typeof graph.nodes> = {
      pending: [], active: [], done: [],
    };
    for (const n of graph.nodes) {
      if (filter !== 'all' && n.status !== filter) continue;
      const col = classifyNode(n.status, n.id === activeNodeId);
      result[col].push(n);
    }
    return result;
  }, [graph, activeNodeId, filter]);

  // Button uses unfiltered counts — filter only affects visibility, not action availability
  const unfilteredPending = graph.nodes.filter(n => classifyNode(n.status, n.id === activeNodeId) === 'pending').length;
  const pendingCount = columns.pending.length;
  const totalCount = graph.nodes.length;

  const colDefs: { key: ColumnKey; title: string; icon: string; bg: string; count: number }[] = [
    { key: 'pending', title: t('graph.toChange'), icon: '●', bg: 'var(--color-bg-layer)', count: columns.pending.length },
    { key: 'active', title: t('action.agentExecuting').replace('⏳ ', ''), icon: '◉', bg: '#fefce8', count: columns.active.length },
    { key: 'done', title: t('status.done'), icon: '✓', bg: '#f0fdf4', count: columns.done.length },
  ];

  const renderCard = (node: typeof graph.nodes[0]) => {
    const c = STATUS_COLORS_SIMPLE[node.status as NodeStatus] || STATUS_COLORS_SIMPLE.existing;
    const isSel = sel === node.id;
    const isHovered = hoveredNode === node.id;
    const isActive = node.id === activeNodeId;
    const actions = getActionsForNode(node.status);

    // Check if dependencies are met
    const incoming = graph.edges.filter(e => e.to === node.id);
    const unmetDeps = incoming.filter(e => {
      const dep = graph.nodes.find(n => n.id === e.from);
      return dep && dep.status !== 'done' && dep.status !== 'existing';
    });
    const blocked = unmetDeps.length > 0 && node.status !== 'done' && node.status !== 'existing';

    return (
      <div
        key={node.id}
        className="rounded-lg cursor-pointer transition-all duration-150 mb-2 relative group"
        style={{
          background: isSel ? c + '0d' : isHovered ? 'var(--color-bg-hover)' : 'var(--color-bg-primary)',
          boxShadow: isSel
            ? `0 0 0 1.5px ${c}50, 0 1px 3px rgba(0,0,0,0.06)`
            : isHovered
              ? '0 0 0 1px var(--color-border-subtle), 0 1px 2px rgba(0,0,0,0.04)'
              : '0 1px 2px rgba(0,0,0,0.04)',
          opacity: blocked ? 0.55 : 1,
        }}
        onMouseEnter={() => setHoveredNode(node.id)}
        onMouseLeave={() => setHoveredNode(null)}
        onClick={() => {
          setExpandedCards(prev => {
            const s = new Set(prev);
            s.has(node.id) ? s.delete(node.id) : s.add(node.id);
            return s;
          });
        }}
      >
        {/* Status color top bar */}
        <div className="h-[3px] rounded-t-lg" style={{ background: c }} />

        <div className="px-3 py-2.5">
          {/* Label + status badge */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--color-text-primary)', wordBreak: 'break-word' }}>
              {node.label}
            </span>
            {node.status !== 'existing' && (
              <span className="text-[9px] px-1.5 py-px rounded-full font-medium shrink-0"
                style={{ background: c + '18', color: c }}>
                {STATUS_LABELS[node.status as NodeStatus]}
              </span>
            )}
            {isActive && (
              <span className="text-[9px] px-1.5 py-px rounded-full font-medium animate-pulse shrink-0"
                style={{ background: '#fef3c7', color: '#b45309' }}>
                ⏳ 执行中
              </span>
            )}
          </div>

          {/* Detail */}
          {node.detail && (
            <div className="text-[10px] leading-snug mb-1.5" style={{ color: 'var(--color-text-muted)', wordBreak: 'break-word' }}>
              {node.detail}
            </div>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {node.file && (
              <span className="inline-flex items-center gap-1 text-[9px] font-mono px-1.5 py-px rounded"
                style={{ background: 'var(--color-bg-layer)', color: '#3b82f6' }}>
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.5">
                  <path d="M2 1 H6 L8 3 V9 H2 Z" strokeLinejoin="round"/>
                </svg>
                {node.file.split(/[\\/]/).pop()}
              </span>
            )}
            {node.line && (
              <span className="text-[9px] opacity-40" style={{ color: 'var(--color-text-muted)' }}>L{node.line}</span>
            )}
            {blocked && (
              <span className="text-[9px] px-1 py-px rounded" style={{ background: '#fef2f2', color: '#dc2626' }}>
                ⏳ 等待依赖
              </span>
            )}
          </div>

          {/* Bottom bar: view-code always, action buttons for pending (never during execution) */}
          {(node.file || (actions.length > 0 && !isActive)) && (
            <div className="flex items-center gap-1 mt-2 pt-2 border-t" style={{ borderColor: 'var(--color-border-subtle)' }}>
              {node.file && (
                <button
                  onClick={(e) => { e.stopPropagation(); onSelect(node.id); }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-medium transition-all duration-150 hover:scale-105"
                  style={{ background: '#eff6ff', color: '#3b82f6' }}>
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <path d="M2 1 H6 L8 3 V9 H2 Z" strokeLinejoin="round"/>
                  </svg>
                  查看代码
                </button>
              )}
              {actions.length > 0 && !isActive && actions.map(action => {
                const cfg = ACTION_CONFIGS[action];
                return (
                  <button
                    key={action}
                    onClick={(e) => { e.stopPropagation(); onSelect(node.id); onRequestAction(action); }}
                    className="px-2 py-0.5 rounded text-[9px] font-medium transition-all duration-150 hover:scale-105 whitespace-nowrap"
                    style={{ background: c + '16', color: c }}
                  >
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Expanded detail — click card to toggle */}
          {expandedCards.has(node.id) && (
            <div className="mt-2 pt-2 border-t space-y-2" style={{ borderColor: 'var(--color-border-subtle)' }}>
              {/* Live output — show for active node */}
              {isActive && liveOutput?.[node.id] && (
                <div className="rounded p-2 text-[9px] font-mono leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap"
                  style={{ background: '#1e1e1e', color: '#d4d4d4' }}>
                  {liveOutput[node.id].replace(/<(list-dir|read-file|run-shell|update|create-file|delete-file|search)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<(list-dir|read-file|run-shell|update|create-file|delete-file|search)\b[^>]*\/>/gi, '').replace(/<done>[^<]*<\/done>/gi, '').replace(/<final\/>/gi, '') || '⏳ 等待 Agent 响应...'}
                </div>
              )}
              {/* Planner detail — always show when expanded */}
              {node.detail && (
                <div className="text-[10px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                  <span className="text-[9px] font-semibold opacity-40 mr-1">📋 Planner:</span>
                  {node.detail}
                </div>
              )}
              {/* Execution record — show if exists */}
              {execRecords?.[node.id] && (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px]" style={{
                      color: execRecords[node.id].review_passed ? '#16a34a' : '#dc2626',
                    }}>
                      {execRecords[node.id].review_passed ? '✅ 通过' : '❌ 未通过'}
                    </span>
                  </div>
                  {execRecords[node.id].review_feedback && (
                    <div className="px-2 py-1 rounded text-[9px]" style={{
                      background: execRecords[node.id].review_passed ? '#f0fdf4' : '#fef2f2',
                      color: execRecords[node.id].review_passed ? '#16a34a' : '#dc2626',
                    }}>
                      {execRecords[node.id].review_feedback}
                    </div>
                  )}
                  {(execRecords[node.id].review_issues?.length ?? 0) > 0 && (
                    <div className="space-y-0.5">
                      {execRecords[node.id].review_issues!.map((issue: any, j: number) => (
                        <div key={j} className="flex items-start gap-1 text-[8px]" style={{ color: '#dc2626' }}>
                          <span className="shrink-0 mt-0.5">⚠</span>
                          <span>[{issue.severity || '?'}] {issue.file || '?'}: {issue.claim || ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Expand toggle indicator */}
          {(node.detail || execRecords?.[node.id]) && (
            <div className="mt-1.5 flex items-center gap-1 text-[9px] cursor-pointer"
              style={{ color: 'var(--color-text-muted)' }}
              onClick={(e) => {
                e.stopPropagation();
                setExpandedCards(prev => {
                  const s = new Set(prev);
                  s.has(node.id) ? s.delete(node.id) : s.add(node.id);
                  return s;
                });
              }}>
              <span>{expandedCards.has(node.id) ? '▾ 收起' : '▸ 展开详情'}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--color-bg-primary)' }}>
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b"
        style={{ borderColor: 'var(--color-border-subtle)', background: 'var(--color-bg-layer)' }}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.4" style={{ color: 'var(--color-text-muted)' }}>
          <rect x="0.5" y="0.5" width="5" height="5" rx="1"/><rect x="10.5" y="0.5" width="5" height="5" rx="1"/>
          <rect x="0.5" y="10.5" width="5" height="5" rx="1"/><rect x="10.5" y="10.5" width="5" height="5" rx="1"/>
        </svg>
        <span className="text-[11px] font-semibold tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
          {t('graph.callGraph')}
        </span>
        <div className="w-px h-4 mx-1" style={{ background: 'var(--color-border-subtle)' }} />

        {[
          { key: 'all', label: t('graph.all') },
          { key: 'problem', label: t('graph.problem') },
          { key: 'planned_change', label: t('graph.toChange') },
          { key: 'planned_new', label: t('graph.new') },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setFilter(key)}
            className="text-[10px] px-2 py-0.5 rounded transition-colors font-medium"
            style={{
              color: filter === key ? '#fff' : 'var(--color-text-muted)',
              background: filter === key
                ? (key === 'problem' ? '#dc2626' : key === 'planned_change' ? '#d97706' : key === 'planned_new' ? '#16a34a' : '#4b5563')
                : 'transparent',
            }}>
            {label}
          </button>
        ))}

        <div className="flex-1" />

        {/* Auto-exec button */}
        {onAutoExec && (
          <>
            {autoExecProgress && autoExecRunning && (
              <span className="text-[10px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
                {autoExecProgress.current}/{autoExecProgress.total}
              </span>
            )}
            <button
              onClick={autoExecRunning ? onStopAutoExec : onAutoExec}
              disabled={streamRunning || (!autoExecRunning && unfilteredPending === 0)}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[11px] font-semibold transition-all duration-150 disabled:opacity-30"
              style={{
                background: autoExecRunning ? '#fee2e2' : '#16a34a',
                color: autoExecRunning ? '#dc2626' : '#fff',
              }}>
              {autoExecRunning ? (
                <>⏹ {t('chat.stop')}</>
              ) : (
                <>▶ 一键执行</>
              )}
            </button>
          </>
        )}

        <span className="text-[10px] font-medium opacity-40" style={{ color: 'var(--color-text-muted)' }}>
          {totalCount}N
        </span>
      </div>

      {/* Kanban columns */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden flex gap-3 px-4">
        {colDefs.map(col => (
          <div key={col.key} className="flex-1 flex flex-col rounded-xl overflow-hidden"
            style={{ minWidth: 220, maxWidth: 400, border: `1px solid var(--color-border-subtle)` }}>
            {/* Column header */}
            <div className="shrink-0 flex items-center gap-1.5 px-3 py-2 border-b"
              style={{ borderColor: 'var(--color-border-subtle)', background: col.bg }}>
              <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{col.icon}</span>
              <span className="text-[10px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                {col.title}
              </span>
              <span className="text-[10px] ml-auto opacity-50" style={{ color: 'var(--color-text-muted)' }}>
                {col.count}
              </span>
            </div>
            {/* Column cards — independent scroll */}
            <div className="flex-1 overflow-y-auto p-2" style={{ background: 'var(--color-bg-primary)' }}>
              {columns[col.key].length === 0 ? (
                <div className="flex items-center justify-center h-20">
                  <span className="text-[10px] opacity-25" style={{ color: 'var(--color-text-muted)' }}>
                    {t('graph.noGraph')}
                  </span>
                </div>
              ) : (
                columns[col.key].map(n => renderCard(n))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Empty state ── */

function EmptyState({ phase }: { phase: Props['phase'] }) {
  const t = useT();
  const msg = phase === 'planning' ? t('graph.analyzing')
    : phase === 'executing' ? t('graph.processing')
    : t('graph.emptyHint');

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4" style={{ background: 'var(--color-bg-primary)' }}>
      <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
        <rect x="8" y="8" width="16" height="16" rx="4" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
        <rect x="32" y="8" width="16" height="16" rx="4" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
        <rect x="8" y="32" width="16" height="16" rx="4" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
        <rect x="32" y="32" width="16" height="16" rx="4" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
      </svg>
      <div className="text-xs text-center max-w-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>{msg}</div>
      <div className="text-[10px] text-center" style={{ color: '#9ca3af' }}>{t('graph.emptyAction')}</div>
    </div>
  );
}

/* ── MapperView ── */

export default function MapperView({ graph, phase, onSelectNode, selectedNode, activeAction, onRequestAction, streamRunning, onAutoExec, onStopAutoExec, autoExecRunning, autoExecProgress, execRecords, liveOutput }: Props) {
  if (!graph || graph.nodes.length === 0) {
    return <EmptyState phase={phase} />;
  }

  return (
    <KanbanBoard
      graph={graph}
      onSelect={(id) => onSelectNode(id)}
      selectedNode={selectedNode}
      onRequestAction={onRequestAction}
      streamRunning={streamRunning}
      onAutoExec={onAutoExec}
      onStopAutoExec={onStopAutoExec}
      autoExecRunning={autoExecRunning}
      autoExecProgress={autoExecProgress}
      execRecords={execRecords}
      liveOutput={liveOutput}
    />
  );
}
