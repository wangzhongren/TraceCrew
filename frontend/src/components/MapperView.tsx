import { useState, useMemo, useEffect } from 'react';
import MapCanvas from './MapCanvas';
import type { CallGraph } from '../types/graph';
import { getActionsForNode, ACTION_CONFIGS } from './ActionDialog';
import type { ActionType } from './ActionDialog';
import { STATUS_COLORS_SIMPLE, STATUS_LABELS } from '../types/theme';
import type { NodeStatus } from '../types/theme';
import { useT } from '../i18n';

interface Props {
  graph: CallGraph | null;
  sequenceGraph: CallGraph | null;
  phase: 'idle' | 'planning' | 'reviewing' | 'done' | 'rejected' | 'clarifying';
  onSelectNode: (id: string | null) => void;
  selectedNode: string | null;
  activeAction: ActionType | null;
  onRequestAction: (action: ActionType) => void;
  streamRunning: boolean;
}

/* ── Helpers ── */

type ColumnKey = 'pending' | 'active' | 'done';

function classifyNode(status: string, isActive: boolean, isAffectedExisting?: boolean): ColumnKey {
  if (isActive) return 'active';
  if (status === 'done') return 'done';
  // existing nodes that are affected by a bug → treat as pending
  if (status === 'existing' && !isAffectedExisting) return 'done';
  return 'pending';
}

/* ── PendingList (refactored: left MapCanvas + right pending list) ── */

function KanbanBoard({ graph, displayGraph, layoutDirection, onSelect, selectedNode: sel, onRequestAction, streamRunning }: {
  graph: CallGraph;
  displayGraph?: CallGraph;
  layoutDirection?: 'TB' | 'LR';
  onSelect: (id: string | null) => void;
  selectedNode: string | null;
  onRequestAction: (action: ActionType) => void;
  streamRunning: boolean;
}) {
  const t = useT();
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  // Auto-expand the active node's card
  useEffect(() => {
    const activeId = streamRunning ? sel : null;
    if (activeId) {
      setExpandedCards(prev => {
        if (prev.has(activeId)) return prev;
        const s = new Set(prev);
        s.add(activeId);
        return s;
      });
    }
  }, [streamRunning, sel]);

  // Compute which node is "active" (currently being worked on)
  const activeNodeId = streamRunning ? sel : null;

  // Collect existing nodes that are affected by a bug (impact_scope.affected_nodes)
  const affectedExistingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const node of graph.nodes) {
      if (node.impact_scope?.affected_nodes) {
        for (const nid of node.impact_scope.affected_nodes) {
          const target = graph.nodes.find(n => n.id === nid);
          if (target && target.status === 'existing') {
            ids.add(nid);
          }
        }
      }
    }
    return ids;
  }, [graph]);

  // Only pending + active nodes (right-side list) — active nodes stay visible while running
  const pendingNodes = useMemo(() =>
    graph.nodes.filter(n => {
      const c = classifyNode(n.status, n.id === activeNodeId, affectedExistingIds.has(n.id));
      return c === 'pending' || c === 'active';
    }),
    [graph, activeNodeId, affectedExistingIds]
  );

  const renderCard = (node: typeof graph.nodes[0]) => {
    const c = STATUS_COLORS_SIMPLE[node.status as NodeStatus] || STATUS_COLORS_SIMPLE.existing;
    const isSel = sel === node.id;
    const isHovered = hoveredNode === node.id;
    const isActive = node.id === activeNodeId;
    const actions = getActionsForNode(node.status);

    return (
      <div
        key={node.id}
        className="rounded-lg cursor-pointer transition-all duration-150 mb-2 relative group"
        style={{
          background: isSel ? `color-mix(in srgb, ${c} 5%, transparent)` : isHovered ? 'var(--ibm-layer-hover)' : 'var(--color-bg-primary)',
          boxShadow: isSel
            ? `0 0 0 1.5px color-mix(in srgb, ${c} 31%, transparent), 0 1px 3px rgba(0,0,0,0.06)`
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
                style={{ background: `color-mix(in srgb, ${c} 9%, transparent)`, color: c }}>
                {STATUS_LABELS[node.status as NodeStatus]}
              </span>
            )}
            {node.status === 'existing' && affectedExistingIds.has(node.id) && (
              <span className="text-[10px] px-1.5 py-px rounded-full font-medium shrink-0"
                style={{ background: 'rgba(169,123,42,.08)', color: '#8f6720' }}>
                受影响
              </span>
            )}
            {isActive && (
              <span className="text-[10px] px-1.5 py-px rounded-full font-medium animate-pulse shrink-0"
                style={{ background: 'rgba(169,123,42,.08)', color: '#8f6720' }}>
                执行中
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
                style={{ background: 'var(--color-bg-layer)', color: 'var(--ibm-link)' }}>
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.5">
                  <path d="M2 1 H6 L8 3 V9 H2 Z" strokeLinejoin="round"/>
                </svg>
                {node.file.split(/[\\/]/).pop()}
              </span>
            )}
            {node.line && (
              <span className="text-[10px] opacity-40" style={{ color: 'var(--color-text-muted)' }}>L{node.line}</span>
            )}
          </div>

          {/* Bottom bar: view-code always, action buttons for pending (never during execution) */}
          {(node.file || (actions.length > 0 && !isActive)) && (
            <div className="flex items-center gap-1 mt-2 pt-2 border-t" style={{ borderColor: 'var(--color-border-subtle)' }}>
              {node.file && (
                <button
                  onClick={(e) => { e.stopPropagation(); window.tracecrew?.file.openFile(node.file!); }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-all duration-150 hover:scale-105"
                  style={{ background: 'rgba(53,96,143,.08)', color: 'var(--ibm-link)' }}>
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
                    className="px-2 py-0.5 rounded text-[10px] font-medium transition-all duration-150 hover:scale-105 whitespace-nowrap"
                    style={{ background: `color-mix(in srgb, ${c} 9%, transparent)`, color: c }}
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
              {/* Planner detail — always show when expanded */}
              {node.detail && (
                <div className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                  <span className="text-[10px] font-semibold opacity-40 mr-1">Planner:</span>
                  {node.detail}
                </div>
              )}
            </div>
          )}

          {/* Expand toggle indicator */}
          {node.detail && (
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
          graph={displayGraph || graph}
          layoutDirection={layoutDirection}
          phase="done"
          selectedNode={null}
          onSelectNode={onSelect}
        />
      </div>

      {/* Right: Pending list */}
      <div className="shrink-0 flex flex-col border-l"
        style={{ width: 320, borderColor: 'var(--color-border-subtle)', background: 'var(--color-bg-primary)' }}>
        {/* Title bar */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b"
          style={{ borderColor: 'var(--color-border-subtle)', background: 'var(--color-bg-layer)' }}>
          <span className="text-[12px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            {t('graph.toChange')}
          </span>
          <span className="text-[11px] opacity-50" style={{ color: 'var(--color-text-muted)' }}>
            {pendingNodes.length}
          </span>
          <div className="flex-1" />
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
      <div className="text-[11px] text-center" style={{ color: 'var(--color-text-muted)' }}>{t('graph.emptyAction')}</div>
    </div>
  );
}

/* ── MapperView ── */

export default function MapperView({ graph, sequenceGraph, phase, onSelectNode, selectedNode, activeAction: _activeAction, onRequestAction, streamRunning }: Props) {
  const [tab, setTab] = useState<'call' | 'dependency' | 'sequence'>('call');
  const hasSequence = sequenceGraph && sequenceGraph.nodes.length > 0;

  if (!graph || graph.nodes.length === 0) {
    return <EmptyState phase={phase} />;
  }

  const activeGraph = tab === 'sequence' && hasSequence ? sequenceGraph! : graph;
  const activeLayout = tab === 'dependency' ? 'LR' as const : 'TB' as const;

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--color-bg-primary)' }}>
      {/* Tab bar — only show when sequence graph exists */}
      {hasSequence && (
        <div className="shrink-0 flex items-center border-b px-2" style={{ borderColor: 'var(--color-border-subtle)', background: 'var(--color-bg-layer)' }}>
          <button
            onClick={() => setTab('call')}
            className="px-3 py-1.5 text-[11px] font-semibold transition-colors rounded-t-md"
            style={{
              color: tab === 'call' ? 'var(--color-text-link)' : 'var(--color-text-muted)',
              borderBottom: tab === 'call' ? '2px solid var(--color-text-link)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            调用图
          </button>
          <button
            onClick={() => setTab('dependency')}
            className="px-3 py-1.5 text-[11px] font-semibold transition-colors rounded-t-md"
            style={{
              color: tab === 'dependency' ? 'var(--color-text-link)' : 'var(--color-text-muted)',
              borderBottom: tab === 'dependency' ? '2px solid var(--color-text-link)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            依赖关系
          </button>
          <button
            onClick={() => setTab('sequence')}
            className="px-3 py-1.5 text-[11px] font-semibold transition-colors rounded-t-md"
            style={{
              color: tab === 'sequence' ? 'var(--color-text-link)' : 'var(--color-text-muted)',
              borderBottom: tab === 'sequence' ? '2px solid var(--color-text-link)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            时序图
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0">
        <KanbanBoard
          graph={graph}
          displayGraph={activeGraph !== graph ? activeGraph : undefined}
          layoutDirection={activeLayout}
          onSelect={onSelectNode}
          selectedNode={selectedNode}
          onRequestAction={onRequestAction}
          streamRunning={streamRunning}
        />
      </div>
    </div>
  );
}
