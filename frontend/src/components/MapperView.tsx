import { useState, useMemo, useEffect } from 'react';
import MapCanvas, { type CallGraph } from './MapCanvas';
import { getActionsForNode, ACTION_CONFIGS } from './ActionDialog';
import type { ActionType } from './ActionDialog';
import { STATUS_COLORS_SIMPLE, STATUS_LABELS } from '../types/theme';
import type { NodeStatus } from '../types/theme';
import { useT } from '../i18n';

interface Props {
  graph: CallGraph | null;
  phase: 'idle' | 'planning' | 'reviewing' | 'done' | 'rejected';
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
  /** Execute a single node directly (without opening right panel) */
  onExecuteNode?: (nodeId: string, action: ActionType) => void;
}

/* ── Helpers ── */

type ColumnKey = 'pending' | 'active' | 'done';

function classifyNode(status: string, isActive: boolean): ColumnKey {
  if (isActive) return 'active';
  if (status === 'done' || status === 'existing') return 'done';
  return 'pending';
}

/* ── PendingList (refactored: left MapCanvas + right pending list) ── */

function KanbanBoard({ graph, onSelect, selectedNode: sel, onRequestAction, streamRunning, onAutoExec, onStopAutoExec, autoExecRunning, autoExecProgress, execRecords, liveOutput, onExecuteNode }: {
  graph: CallGraph;
  onSelect: (id: string | null) => void;
  selectedNode: string | null;
  onRequestAction: (action: ActionType) => void;
  streamRunning: boolean;
  onAutoExec?: () => void;
  onStopAutoExec?: () => void;
  autoExecRunning?: boolean;
  autoExecProgress?: { current: number; total: number; currentNodeId: string | null } | null;
  execRecords?: Record<string, { summary: string; review_passed: boolean | null; review_feedback?: string; review_issues?: any[] }>;
  liveOutput?: Record<string, string>;
  onExecuteNode?: (nodeId: string, action: ActionType) => void;
}) {
  const t = useT();
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

  // Only pending + active nodes (right-side list) — active nodes stay visible for live output
  const pendingNodes = useMemo(() =>
    graph.nodes.filter(n => {
      const c = classifyNode(n.status, n.id === activeNodeId);
      return c === 'pending' || c === 'active';
    }),
    [graph, activeNodeId]
  );

  // Unfiltered pending count for button disabled logic (ignores activeNodeId)
  const unfilteredPending = graph.nodes.filter(n => classifyNode(n.status, false) === 'pending').length;

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
          opacity: 1,
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
            <span className="text-[12px] font-semibold" style={{ color: 'var(--color-text-primary)', wordBreak: 'break-word' }}>
              {node.label}
            </span>
            {node.status !== 'existing' && (
              <span className="text-[10px] px-1.5 py-px rounded-full font-medium shrink-0"
                style={{ background: c + '18', color: c }}>
                {STATUS_LABELS[node.status as NodeStatus]}
              </span>
            )}
            {isActive && (
              <span className="text-[10px] px-1.5 py-px rounded-full font-medium animate-pulse shrink-0"
                style={{ background: '#fef3c7', color: '#b45309' }}>
                ⏳ 执行中
              </span>
            )}
          </div>

          {/* Detail */}
          {node.detail && (
            <div className="text-[11px] leading-snug mb-1.5" style={{ color: 'var(--color-text-muted)', wordBreak: 'break-word' }}>
              {node.detail}
            </div>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {node.file && (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-px rounded"
                style={{ background: 'var(--color-bg-layer)', color: '#3b82f6' }}>
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.5">
                  <path d="M2 1 H6 L8 3 V9 H2 Z" strokeLinejoin="round"/>
                </svg>
                {node.file.split(/[\\/]/).pop()}
              </span>
            )}
            {node.line && (
              <span className="text-[10px] opacity-40" style={{ color: 'var(--color-text-muted)' }}>L{node.line}</span>
            )}
            {blocked && (
              <span className="text-[10px] px-1 py-px rounded" style={{ background: '#fffbeb', color: '#b45309' }}>
                ⚠ 依赖未完成
              </span>
            )}
          </div>

          {/* Bottom bar: view-code always, action buttons for pending (never during execution) */}
          {(node.file || (actions.length > 0 && !isActive)) && (
            <div className="flex items-center gap-1 mt-2 pt-2 border-t" style={{ borderColor: 'var(--color-border-subtle)' }}>
              {node.file && (
                <button
                  onClick={(e) => { e.stopPropagation(); window.tracecrew?.file.openFile(node.file!); }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-all duration-150 hover:scale-105"
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
                    onClick={(e) => { e.stopPropagation(); if (onExecuteNode) { onExecuteNode(node.id, action); } else { onSelect(node.id); onRequestAction(action); } }}
                    className="px-2 py-0.5 rounded text-[10px] font-medium transition-all duration-150 hover:scale-105 whitespace-nowrap"
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
              {isActive && liveOutput?.[node.id] !== undefined && (
                <div className="rounded p-2 text-[10px] font-mono leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap"
                  style={{ background: '#1e1e1e', color: '#d4d4d4' }}>
                  {liveOutput[node.id]?.replace(/<(list-dir|read-file|run-shell|update|create-file|delete-file|search)\b[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<(list-dir|read-file|run-shell|update|create-file|delete-file|search)\b[^>]*\/>/gi, '').replace(/<done>[^<]*<\/done>/gi, '').replace(/<final\/>/gi, '') || '⏳ 等待 Agent 响应...'}
                </div>
              )}
              {/* Planner detail — always show when expanded */}
              {node.detail && (
                <div className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                  <span className="text-[10px] font-semibold opacity-40 mr-1">📋 Planner:</span>
                  {node.detail}
                </div>
              )}
              {/* Execution record — show if exists */}
              {execRecords?.[node.id] && (() => {
                  const rec = execRecords[node.id];
                  const passed = rec.review_passed; // true | false | null
                  const isGreen = passed !== false; // null = no review needed, treat as success
                  return (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px]" style={{ color: isGreen ? '#16a34a' : '#dc2626' }}>
                      {passed === true ? '✅ 通过' : passed === false ? '❌ 未通过' : '✅ 完成'}
                    </span>
                  </div>
                  {rec.review_feedback && (
                    <div className="px-2 py-1 rounded text-[10px]" style={{
                      background: isGreen ? '#f0fdf4' : '#fef2f2',
                      color: isGreen ? '#16a34a' : '#dc2626',
                    }}>
                      {rec.review_feedback}
                    </div>
                  )}
                  {(rec.review_issues?.length ?? 0) > 0 && (
                    <div className="space-y-0.5">
                      {rec.review_issues!.map((issue: any, j: number) => (
                        <div key={j} className="flex items-start gap-1 text-[9px]" style={{ color: '#dc2626' }}>
                          <span className="shrink-0 mt-0.5">⚠</span>
                          <span>[{issue.severity || '?'}] {issue.file || '?'}: {issue.claim || ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              );})()}
            </div>
          )}

          {/* Expand toggle indicator */}
          {(node.detail || execRecords?.[node.id]) && (
            <div className="mt-1.5 flex items-center gap-1 text-[10px] cursor-pointer"
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
    <div className="h-full flex flex-row" style={{ background: 'var(--color-bg-primary)' }}>
      {/* Left: MapCanvas — fills remaining space */}
      <div className="flex-1 overflow-hidden" style={{ minWidth: 0 }}>
        <MapCanvas
          graph={graph}
          phase="done"
          selectedNode={null}
          onSelectNode={onSelect}
        />
      </div>

      {/* Right: Pending list */}
      <div className="shrink-0 flex flex-col border-l"
        style={{ width: 320, borderColor: 'var(--color-border-subtle)', background: 'var(--color-bg-primary)' }}>
        {/* Title bar with one-click execute button */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b"
          style={{ borderColor: 'var(--color-border-subtle)', background: 'var(--color-bg-layer)' }}>
          <span className="text-[12px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            {t('graph.toChange')}
          </span>
          <span className="text-[11px] opacity-50" style={{ color: 'var(--color-text-muted)' }}>
            {pendingNodes.length}
          </span>
          <div className="flex-1" />
          {/* One-click execute button */}
          {onAutoExec && (
            <>
              {autoExecProgress && autoExecRunning && (
                <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>
                  {autoExecProgress.current}/{autoExecProgress.total}
                </span>
              )}
              <button
                onClick={autoExecRunning ? onStopAutoExec : onAutoExec}
                disabled={streamRunning || (!autoExecRunning && unfilteredPending === 0)}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-[12px] font-semibold transition-all duration-150 disabled:opacity-30"
                style={{
                  background: autoExecRunning ? '#fce8e6' : '#1a73e8',
                  color: autoExecRunning ? '#ea4335' : '#fff',
                }}>
                {autoExecRunning ? <>⏹ {t('chat.stop')}</> : <>▶ 一键执行</>}
              </button>
            </>
          )}
        </div>

        {/* Card list — scrollable */}
        <div className="flex-1 overflow-y-auto p-2">
          {pendingNodes.length === 0 ? (
            <div className="flex items-center justify-center h-20">
              <span className="text-[11px] opacity-25" style={{ color: 'var(--color-text-muted)' }}>
                {t('graph.noGraph')}
              </span>
            </div>
          ) : (
            pendingNodes.map(n => renderCard(n))
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Empty state ── */

function EmptyState({ phase }: { phase: Props['phase'] }) {
  const t = useT();
  const msg = phase === 'planning' ? t('graph.analyzing')
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
      <div className="text-[11px] text-center" style={{ color: '#9ca3af' }}>{t('graph.emptyAction')}</div>
    </div>
  );
}

/* ── MapperView ── */

export default function MapperView({ graph, phase, onSelectNode, selectedNode, activeAction: _activeAction, onRequestAction, streamRunning, onAutoExec, onStopAutoExec, autoExecRunning, autoExecProgress, execRecords, liveOutput, onExecuteNode }: Props) {
  if (!graph || graph.nodes.length === 0) {
    return <EmptyState phase={phase} />;
  }

  return (
    <KanbanBoard
      graph={graph}
      onSelect={onSelectNode}
      selectedNode={selectedNode}
      onRequestAction={onRequestAction}
      streamRunning={streamRunning}
      onAutoExec={onAutoExec}
      onStopAutoExec={onStopAutoExec}
      autoExecRunning={autoExecRunning}
      autoExecProgress={autoExecProgress}
      execRecords={execRecords}
      liveOutput={liveOutput}
      onExecuteNode={onExecuteNode}
    />
  );
}
