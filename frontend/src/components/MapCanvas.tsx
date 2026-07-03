import { useRef, useEffect, useState, useCallback, useMemo, memo } from 'react';
import dagre from 'dagre';
import { STATUS_COLORS, EDGE_COLORS, STATUS_LABELS, BUG_IMPACT_COLORS } from '../types/theme';
import type { NodeStatus, SubComponent, ImpactScope } from '../types/theme';
import { useT } from '../i18n';

/* ═══════════════════════════════════════════════════════════
   Call Graph Canvas — Node-Link diagram for code structure
   ═══════════════════════════════════════════════════════════ */

export interface GraphNode {
  id: string;
  label: string;
  kind: string;
  status: NodeStatus;
  detail: string;
  file?: string;
  line?: number;
  /** Widget/service composition for planned_new nodes */
  sub_components?: SubComponent[];
  /** Bug impact analysis for problem nodes */
  impact_scope?: ImpactScope;
  /** Sequence diagram: swimlane name */
  lane?: string;
  /** Sequence diagram: position in timeline (1-based) */
  step?: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  label: string;
  status: 'existing' | 'new' | 'removed' | 'error';
}

export interface CallGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ContextMenuAction {
  node: GraphNode;
  x: number;
  y: number;
}

interface Props {
  graph: CallGraph | null;
  phase: 'idle' | 'planning' | 'executing' | 'reviewing' | 'done' | 'rejected';
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
  onContextMenu?: (action: ContextMenuAction) => void;
  /** Layout direction: 'TB' (top→bottom) or 'LR' (left→right) */
  layoutDirection?: 'TB' | 'LR';
}

/* ── Dagre layered layout ── */
interface LayoutNode extends GraphNode {
  x: number; y: number; h: number;
}

const NODE_W = 280;
const X_GAP = 56, Y_GAP = 60;

/** Estimate node height from content length */
function calcNodeHeight(n: GraphNode): number {
  const labelW = NODE_W - 42;
  const labelCJK = ((n.label.match(/[一-鿿]/g) || []).length) * 13;
  const labelASCII = (n.label.replace(/[一-鿿]/g, '').length) * 7;
  const labelLines = Math.max(1, Math.ceil((labelCJK + labelASCII) / labelW));

  const hasKind = !!n.kind;
  const hasFile = !!n.file;
  const hasDetail = !!n.detail;

  // Base: header(28) + label(17/line) + bottom(16)
  let h = 28 + labelLines * 17 + 16;
  h += 14; // status label row
  if (hasKind) h += 14;
  if (hasFile) h += 14;

  // Detail area (font-size 11, line-height 15, width NODE_W-28)
  if (hasDetail) {
    const dW = NODE_W - 28;
    const dCJK = ((n.detail.match(/[一-鿿]/g) || []).length) * 11;
    const dASCII = (n.detail.replace(/[一-鿿]/g, '').length) * 6;
    const dLines = Math.max(1, Math.ceil((dCJK + dASCII) / dW));
    h += dLines * 15 + 12;
  }

  return Math.max(h, 76);
}

const VIRTUAL_ROOT = '__vr__';

function layoutGraph(graph: CallGraph, rankdir: 'TB' | 'LR' = 'TB'): { nodes: LayoutNode[]; edges: (GraphEdge & { back?: boolean })[] } {
  const { nodes, edges } = graph;
  if (nodes.length === 0) return { nodes: [], edges };

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir, nodesep: X_GAP, ranksep: Y_GAP });
  g.setDefaultEdgeLabel(() => ({}));

  // Add nodes with dimensions
  const nodeHeights = new Map<string, number>();
  for (const n of nodes) {
    const h = calcNodeHeight(n);
    nodeHeights.set(n.id, h);
    g.setNode(n.id, { width: NODE_W, height: h });
  }

  // Add edges
  for (const e of edges) {
    g.setEdge(e.from, e.to);
  }

  // Virtual root: tie all entry points to a single invisible root
  // This gives dagre a single DAG root, producing uniform layer-0 alignment
  const hasIncoming = new Set(edges.map(e => e.to));
  const entryPoints = nodes.filter(n => !hasIncoming.has(n.id));
  if (entryPoints.length > 1) {
    g.setNode(VIRTUAL_ROOT, { width: 1, height: 1 });
    for (const ep of entryPoints) {
      g.setEdge(VIRTUAL_ROOT, ep.id);
    }
  }

  // Run dagre — longest-path layering + crossing minimization
  dagre.layout(g);

  // Read positions back (dagre returns center coords → convert to top-left)
  const layouted: LayoutNode[] = nodes.map(n => {
    const pos = g.node(n.id);
    const h = nodeHeights.get(n.id) || 76;
    return { ...n, x: pos.x - NODE_W / 2, y: pos.y - h / 2, h };
  });

  // Detect back-edges for curved rendering
  const markupEdges = edges.map((e) => {
    const from = layouted.find(n => n.id === e.from);
    const to = layouted.find(n => n.id === e.to);
    if (from && to && from.y >= to.y) {
      return { ...e, back: true };
    }
    return e;
  });

  return { nodes: layouted, edges: markupEdges };
}

/* ══════════════════════════════════════════════════ */

function MapCanvas({ graph, phase, selectedNode, onSelectNode, onContextMenu, layoutDirection = 'TB' }: Props) {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 60, y: 40, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState<string>('all');

  // Entry-point groups + active members (must be before layout)
  const entryGroups = useMemo(() => {
    if (!graph || graph.nodes.length === 0) return [] as Array<{ id: string; label: string; members: Set<string> }>;
    const hasIncoming = new Set(graph.edges.map(e => e.to));
    const entryPoints = graph.nodes.filter(n => !hasIncoming.has(n.id));
    if (entryPoints.length <= 1) return [];

    const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
    const result: Array<{ id: string; label: string; members: Set<string> }> = [];
    for (const ep of entryPoints) {
      const members = new Set<string>();
      const queue = [ep.id];
      const visited = new Set<string>();
      while (queue.length > 0) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        members.add(id);
        for (const e of graph.edges) {
          if (e.from === id) queue.push(e.to);
        }
      }
      result.push({
        id: ep.id,
        label: (nodeMap.get(ep.id) || ep).label.replace(/^\[.*?\]\s*/, ''),
        members,
      });
    }
    return result;
  }, [graph]);

  const activeMembers = useMemo(() => {
    if (!graph || groupFilter === 'all' || entryGroups.length === 0) return null;
    return entryGroups.find(g => g.id === groupFilter)?.members || null;
  }, [graph, groupFilter, entryGroups]);

  // Content fingerprint — only properties that affect Dagre layout (node labels/detail
  // lengths determine node height; edge from/to/status affect edge rendering paths).
  // Using a fingerprint key instead of [graph] reference avoids re-layout when a new
  // graph object has identical content (e.g. after a no-op merge in MapperView).
  const layoutFingerprint = useMemo(() => {
    if (!graph) return '';
    // Include groupFilter so layout recomputes when group changes
    const inputGraph = activeMembers
      ? { nodes: graph.nodes.filter(n => activeMembers.has(n.id)), edges: graph.edges.filter(e => activeMembers.has(e.from) && activeMembers.has(e.to)) }
      : graph;
    const nodeKeys = inputGraph.nodes.map(n =>
      `${n.id}|${n.status}|${n.label.length}|${(n.detail || '').length}|${n.kind || ''}|${n.file || ''}|` +
      `${(n.impact_scope?.affected_nodes || []).join(',')}|${(n.sub_components || []).map(c => c.id).join(',')}|` +
      `${n.lane || ''}|${n.step || ''}`
    ).sort().join(',');
    const edgeKeys = inputGraph.edges.map(e =>
      `${e.from}->${e.to}|${e.status}`
    ).sort().join(',');
    return `${groupFilter}|${nodeKeys}::${edgeKeys}`;
  }, [graph, groupFilter, activeMembers]);

  const layouted = useMemo(() => {
    if (!graph) return { nodes: [] as LayoutNode[], edges: [] as GraphEdge[] };
    // Use filtered graph when a group is selected
    const inputGraph = activeMembers
      ? { nodes: graph.nodes.filter(n => activeMembers.has(n.id)), edges: graph.edges.filter(e => activeMembers.has(e.from) && activeMembers.has(e.to)) }
      : graph;
    return layoutGraph(inputGraph, layoutDirection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutFingerprint, layoutDirection]);

  // Auto-fit on new graph — only reset view when the graph is genuinely different
  // (no node ID overlap with previous graph), not on incremental updates like fix/refactor.
  const prevNodeIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!graph || graph.nodes.length === 0) return;
    const currentIds = new Set(graph.nodes.map(n => n.id));
    const hasOverlap = prevNodeIds.current.size > 0 &&
      [...currentIds].some(id => prevNodeIds.current.has(id));
    if (!hasOverlap) {
      setTransform({ x: 60, y: 40, scale: 0.85 });
      onSelectNode(null);
    }
    prevNodeIds.current = currentIds;
  }, [graph]);

// Wheel zoom — native listener to bypass passive event restriction
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.12 : 0.12;
      setTransform((t) => ({ ...t, scale: Math.max(0.2, Math.min(2.5, t.scale + delta)) }));
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);


  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as SVGElement)?.tagName === 'svg' || (e.target as SVGElement)?.classList?.contains?.('bg-layer')) {
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
    }
  }, [transform]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    setTransform((t) => ({
      ...t,
      x: dragStart.current.tx + (e.clientX - dragStart.current.x),
      y: dragStart.current.ty + (e.clientY - dragStart.current.y),
    }));
  }, [dragging]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  // Status summary counts
  const statusCounts = useMemo(() => {
    if (!graph) return {};
    const counts: Record<string, number> = {};
    for (const n of graph.nodes) counts[n.status] = (counts[n.status] || 0) + 1;
    return counts;
  }, [graph]);

  // Bug impact view: compute trigger edges + affected nodes from impact_scope
  const impactView = useMemo(() => {
    const triggerEdges = new Set<string>();
    const affectedNodes = new Set<string>();
    const triggerPathNodes = new Set<string>();
    if (!graph) return { triggerEdges, affectedNodes, triggerPathNodes };
    for (const node of graph.nodes) {
      if (node.impact_scope) {
        const path = node.impact_scope.trigger_path;
        for (let i = 0; i < path.length - 1; i++) {
          triggerEdges.add(`${path[i]}->${path[i + 1]}`);
          triggerPathNodes.add(path[i]);
          triggerPathNodes.add(path[i + 1]);
        }
        for (const nid of node.impact_scope.affected_nodes) {
          affectedNodes.add(nid);
        }
      }
    }
    return { triggerEdges, affectedNodes, triggerPathNodes };
  }, [graph]);

  return (
    <div ref={containerRef} className="relative h-full overflow-hidden" style={{ background: '#f7f8fa' }}>
      {/* Background dot grid */}
      <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
        <defs>
          <pattern id="dotGrid" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx="12" cy="12" r="0.8" fill="#000000" opacity="0.05"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dotGrid)"/>
      </svg>

      {/* Empty state */}
      {(!graph || graph.nodes.length === 0) && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'transparent', zIndex: 10 }}>
          <div className="text-center space-y-5 max-w-xs">
            {/* Graph network illustration — Material Design styled */}
            <svg width="200" height="140" viewBox="0 0 200 140" fill="none" className="mx-auto" style={{ opacity: 0.30 }}>
              {/* Filters + patterns */}
              <defs>
                <filter id="empty-card-shadow" x="-8%" y="-8%" width="116%" height="130%">
                  <feDropShadow dx="0" dy="1.5" stdDeviation="3" floodColor="#000" floodOpacity="0.08"/>
                </filter>
                <pattern id="dot-grid" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                  <circle cx="10" cy="10" r="1" fill="var(--color-text-muted)" opacity="0.15"/>
                </pattern>
              </defs>
              <rect x="0" y="0" width="200" height="140" fill="url(#dot-grid)" rx="12"/>

              {/* Edges — curved bezier connections */}
              <path d="M100,28 C100,50 46,45 46,65" stroke="var(--color-text-muted)" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"/>
              <path d="M100,28 C100,50 154,45 154,65" stroke="var(--color-text-muted)" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"/>
              <path d="M46,83 C46,100 30,100 30,112" stroke="var(--color-text-muted)" strokeWidth="1.2" strokeLinecap="round" opacity="0.3"/>
              <path d="M46,83 C46,100 62,100 62,112" stroke="var(--color-text-muted)" strokeWidth="1.2" strokeLinecap="round" opacity="0.3"/>
              <path d="M154,83 C154,100 138,100 138,112" stroke="var(--color-text-muted)" strokeWidth="1.2" strokeLinecap="round" opacity="0.3"/>
              <path d="M154,83 C154,100 170,100 170,112" stroke="var(--color-text-muted)" strokeWidth="1.2" strokeLinecap="round" opacity="0.3"/>

              {/* Level 1 — Root node (center top) */}
              <g filter="url(#empty-card-shadow)">
                <rect x="70" y="12" width="60" height="28" rx="8" fill="var(--color-bg-primary)" stroke="var(--color-text-muted)" strokeWidth="1" opacity="0.6"/>
                <rect x="72" y="12" width="3" height="28" rx="1.5" fill="var(--color-status-done)" opacity="0.7"/>
                <rect x="80" y="22" width="12" height="3" rx="1.5" fill="var(--color-text-muted)" opacity="0.3"/>
                <rect x="96" y="22" width="22" height="3" rx="1.5" fill="var(--color-text-muted)" opacity="0.15"/>
              </g>

              {/* Level 2 — Two child nodes */}
              <g filter="url(#empty-card-shadow)">
                <rect x="18" y="58" width="56" height="28" rx="8" fill="var(--color-bg-primary)" stroke="var(--color-text-muted)" strokeWidth="1" opacity="0.6"/>
                <rect x="20" y="58" width="3" height="28" rx="1.5" fill="var(--color-status-problem)" opacity="0.7"/>
                <rect x="28" y="68" width="10" height="3" rx="1.5" fill="var(--color-text-muted)" opacity="0.3"/>
                <rect x="42" y="68" width="20" height="3" rx="1.5" fill="var(--color-text-muted)" opacity="0.15"/>
              </g>
              <g filter="url(#empty-card-shadow)">
                <rect x="126" y="58" width="56" height="28" rx="8" fill="var(--color-bg-primary)" stroke="var(--color-text-muted)" strokeWidth="1" opacity="0.6"/>
                <rect x="128" y="58" width="3" height="28" rx="1.5" fill="var(--color-status-new)" opacity="0.7"/>
                <rect x="136" y="68" width="10" height="3" rx="1.5" fill="var(--color-text-muted)" opacity="0.3"/>
                <rect x="150" y="68" width="20" height="3" rx="1.5" fill="var(--color-text-muted)" opacity="0.15"/>
              </g>

              {/* Level 3 — Leaf nodes */}
              <g filter="url(#empty-card-shadow)">
                <rect x="4" y="106" width="44" height="24" rx="7" fill="var(--color-bg-primary)" stroke="var(--color-text-muted)" strokeWidth="0.8" opacity="0.5"/>
                <rect x="6" y="106" width="2.5" height="24" rx="1.5" fill="var(--color-status-existing)" opacity="0.6"/>
                <rect x="14" y="116" width="8" height="2.5" rx="1.5" fill="var(--color-text-muted)" opacity="0.25"/>
                <rect x="26" y="116" width="16" height="2.5" rx="1.5" fill="var(--color-text-muted)" opacity="0.12"/>
              </g>
              <g filter="url(#empty-card-shadow)">
                <rect x="52" y="106" width="44" height="24" rx="7" fill="var(--color-bg-primary)" stroke="var(--color-text-muted)" strokeWidth="0.8" opacity="0.5"/>
                <rect x="54" y="106" width="2.5" height="24" rx="1.5" fill="var(--color-status-existing)" opacity="0.6"/>
                <rect x="62" y="116" width="8" height="2.5" rx="1.5" fill="var(--color-text-muted)" opacity="0.25"/>
                <rect x="74" y="116" width="16" height="2.5" rx="1.5" fill="var(--color-text-muted)" opacity="0.12"/>
              </g>
              <g filter="url(#empty-card-shadow)">
                <rect x="112" y="106" width="44" height="24" rx="7" fill="var(--color-bg-primary)" stroke="var(--color-text-muted)" strokeWidth="0.8" opacity="0.5"/>
                <rect x="114" y="106" width="2.5" height="24" rx="1.5" fill="var(--color-status-existing)" opacity="0.6"/>
                <rect x="122" y="116" width="8" height="2.5" rx="1.5" fill="var(--color-text-muted)" opacity="0.25"/>
                <rect x="134" y="116" width="16" height="2.5" rx="1.5" fill="var(--color-text-muted)" opacity="0.12"/>
              </g>
              <g filter="url(#empty-card-shadow)">
                <rect x="160" y="106" width="36" height="24" rx="7" fill="var(--color-bg-primary)" stroke="var(--color-text-muted)" strokeWidth="0.8" opacity="0.5"/>
                <rect x="162" y="106" width="2.5" height="24" rx="1.5" fill="var(--color-status-existing)" opacity="0.6"/>
                <rect x="170" y="116" width="6" height="2.5" rx="1.5" fill="var(--color-text-muted)" opacity="0.25"/>
                <rect x="180" y="116" width="10" height="2.5" rx="1.5" fill="var(--color-text-muted)" opacity="0.12"/>
              </g>
            </svg>

            {/* Title */}
            <div>
              <p className="text-sm font-medium tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
                {t('graph.callGraph')}
              </p>
              <p className="text-xs font-light mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
                {phase === 'idle' ? t('graph.emptyHint') :
                 phase === 'planning' ? t('graph.analyzing') :
                 phase === 'executing' || phase === 'reviewing' ? t('graph.processing') : t('graph.noGraph')}
              </p>
            </div>

            {/* Pipeline step indicator */}
            {phase !== 'idle' && (
              <div className="flex items-center justify-center gap-1.5 mt-1">
                {(['planning', 'reviewing', 'executing'] as const).map((step, i) => (
                  <span key={step} className="flex items-center gap-1.5">
                    <span className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full" style={{
                        background: phase === step ? 'var(--color-text-link)' : 'var(--color-text-disabled)',
                        animation: phase === step ? 'pulse-dot 1.5s ease-in-out infinite' : 'none',
                      }} />
                      <span className="text-[10px] font-light" style={{
                        color: phase === step ? 'var(--color-text-link)' : 'var(--color-text-disabled)',
                      }}>
                        {step === 'planning' ? 'Planner' : step === 'reviewing' ? 'Reviewer' : 'Mapper'}
                      </span>
                    </span>
                    {i < 2 && <span className="text-[10px]" style={{ color: 'var(--color-text-disabled)' }}>→</span>}
                  </span>
                ))}
              </div>
            )}

            {/* Idle hint: point to chat panel */}
            {phase === 'idle' && (
              <p className="text-[11px] font-light leading-relaxed" style={{ color: 'var(--color-text-disabled)' }}>
                {t('graph.emptyAction')}
              </p>
            )}
          </div>
        </div>
      )}

      {/* SVG canvas */}
      <svg ref={svgRef} className="absolute inset-0 w-full h-full bg-layer"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}>

        {/* SVG filters for Material Design card shadows */}
        <defs>
          <filter id="card-shadow" x="-8%" y="-4%" width="116%" height="116%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#000" floodOpacity="0.12" />
          </filter>
          <filter id="card-shadow-hover" x="-8%" y="-4%" width="116%" height="116%">
            <feDropShadow dx="0" dy="3" stdDeviation="10" floodColor="#000" floodOpacity="0.18" />
          </filter>
        </defs>

        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}>
          {/* Edges */}
          {layouted.edges.map((edge: any, i: number) => {
            const from = layouted.nodes.find((n) => n.id === edge.from);
            const to = layouted.nodes.find((n) => n.id === edge.to);
            if (!from || !to) return null;
            const edgeInGroup = !activeMembers || (activeMembers.has(edge.from) && activeMembers.has(edge.to));
            if (!edgeInGroup) return null; // hide edges outside selected group
            const edgeConnected = selectedNode
              ? new Set([selectedNode, ...layouted.edges.filter((e: any) => e.from === selectedNode || e.to === selectedNode).flatMap((e: any) => [e.from, e.to])])
              : null;
            const edgeDimmed = edgeConnected && !(edgeConnected.has(edge.from) && edgeConnected.has(edge.to));

            const ec = EDGE_COLORS[edge.status] || EDGE_COLORS.existing;
            const isError = edge.status === 'error';
            const isNew = edge.status === 'new';
            const isTriggerEdge = impactView.triggerEdges.has(`${edge.from}->${edge.to}`);
            const isBack = edge.back;

            if (isBack) {
              // Back-edge: loop from right side of source, arc around, enter right side of target
              const sx = from.x + NODE_W;
              const sy = from.y + from.h / 2;
              const tx = to.x + NODE_W;
              const ty = to.y + to.h / 2;
              const midX = Math.max(sx, tx) + 50;

              return (
                <g key={`e${i}`} style={{ opacity: edgeDimmed ? 0.15 : 1, transition: 'opacity 0.3s' }}>
                  <path
                    d={`M${sx},${sy} C${midX},${sy} ${midX},${ty} ${tx},${ty}`}
                    fill="none" stroke="#e11d48" strokeWidth={1.5}
                    strokeDasharray="6,3" opacity={0.6} />
                  <polygon points={`${tx-6},${ty-4} ${tx-2},${ty} ${tx-6},${ty+4}`}
                    fill="#e11d48" opacity={0.7} />
                  <text x={midX - 4} y={(sy + ty) / 2 - 6} textAnchor="end"
                    fill="#e11d48" fontSize="9" fontFamily="var(--font-family-ui)" opacity={0.6}>
                    ↩ {edge.label || t('graph.feedback')}
                  </text>
                </g>
              );
            }

            const x1 = from.x + NODE_W / 2;
            const y1 = from.y + from.h;
            const x2 = to.x + NODE_W / 2;
            const y2 = to.y;
            // Spread overlapping edge labels: deterministic per-edge y-offset based on endpoints
            const labelOffsetY = ((from.x * 7 + to.x * 13) % 15) - 7;

            return (
              <g key={`e${i}`} style={{ opacity: edgeDimmed ? 0.12 : 1, transition: 'opacity 0.3s' }}>
                {(isError || isNew) && (
                  <path d={`M${x1},${y1} L${x1},${(y1+y2)/2} L${x2},${(y1+y2)/2} L${x2},${y2-8}`}
                    fill="none" stroke={ec} strokeWidth={2.5} opacity={0.10}
                    strokeLinejoin="round" />
                )}
                <path d={`M${x1},${y1} L${x1},${(y1+y2)/2} L${x2},${(y1+y2)/2} L${x2},${y2-8}`}
                  fill="none" stroke={isTriggerEdge ? BUG_IMPACT_COLORS.triggerEdge : ec}
                  strokeWidth={isTriggerEdge ? BUG_IMPACT_COLORS.triggerEdgeWidth : (isError || isNew ? 1.6 : 1.2)}
                  strokeLinejoin="round"
                  strokeDasharray={edge.status === 'removed' ? '6,4' : undefined}
                  opacity={isTriggerEdge ? 0.8 : (edge.status === 'removed' ? 0.5 : 0.55)} />
                <polygon
                  points={`${x2-5},${y2-9} ${x2+5},${y2-9} ${x2},${y2-3}`}
                  fill={isTriggerEdge ? BUG_IMPACT_COLORS.triggerEdge : ec} opacity={isTriggerEdge ? 0.85 : 0.65} />
                {edge.label && (
                  <text x={(x1+x2)/2} y={(y1+y2)/2 - 6 + labelOffsetY} textAnchor="middle"
                    fill="var(--color-text-muted)" fontSize="9" fontFamily="var(--font-family-ui)">
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {layouted.nodes.map((node) => {
            const c = STATUS_COLORS[node.status as NodeStatus] || STATUS_COLORS.existing;
            const isSelected = selectedNode === node.id;
            const isHovered = hoveredNode === node.id;
            const connected = selectedNode
              ? new Set([selectedNode, ...layouted.edges.filter(e => e.from === selectedNode || e.to === selectedNode).flatMap(e => [e.from, e.to])])
              : null;
            const dimmed = connected ? !connected.has(node.id) : false;
            const isProblem = node.status === 'problem';
            const isAffected = impactView.affectedNodes.has(node.id);
            const isTriggerNode = impactView.triggerPathNodes.has(node.id);
            const isInGroup = !activeMembers || activeMembers.has(node.id);
            // Start/end detection
            const hasIncoming = layouted.edges.some((e: any) => e.to === node.id);
            const hasOutgoing = layouted.edges.some((e: any) => e.from === node.id);
            const isStart = !hasIncoming;
            const isEnd = !hasOutgoing;
            const labelW = NODE_W - 42;
            const estPerLine = Math.floor(labelW / 10);
            const labelLen = Math.ceil(node.label.length / estPerLine);
            const lineY = node.y + 22;

            return (
              <g key={node.id}
                filter={isHovered ? 'url(#card-shadow-hover)' : 'url(#card-shadow)'}
                style={{
                  cursor: 'pointer', transition: 'opacity 0.2s',
                  opacity: (!isInGroup) ? 0 : (dimmed ? 0.25 : 1),
                  display: (!isInGroup) ? 'none' : undefined,
                }}
                onClick={() => onSelectNode(isSelected ? null : node.id)}
                onContextMenu={(e) => { e.preventDefault(); onContextMenu?.({ node, x: e.clientX, y: e.clientY }); }}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}>

                {/* Problem glow */}
                {isProblem && (
                  <rect x={node.x - 4} y={node.y - 4} width={NODE_W + 8} height={node.h + 8} rx={14}
                    fill="none" stroke={c.stroke} strokeWidth={2} opacity={0.2 + (isHovered ? 0.15 : 0)}
                    style={{ transition: 'opacity 0.3s' }} />
                )}

                {/* Card background */}
                <rect x={node.x} y={node.y} width={NODE_W} height={node.h} rx={12}
                  fill={isAffected ? BUG_IMPACT_COLORS.affectedBg : c.fill}
                  stroke={isHovered || isSelected ? c.stroke : c.badge}
                  strokeWidth={isSelected ? 2 : isHovered ? 1.8 : 1}
                  strokeOpacity={isHovered || isSelected ? 1 : 0.25} />

                {/* Affected node: orange dashed border */}
                {isAffected && !isProblem && (
                  <rect x={node.x - 3} y={node.y - 3} width={NODE_W + 6} height={node.h + 6} rx={14}
                    fill="none" stroke={BUG_IMPACT_COLORS.affectedBorder}
                    strokeWidth={1.8} strokeDasharray={BUG_IMPACT_COLORS.affectedDash}
                    opacity={0.7} />
                )}

                {/* Trigger path node: small indicator dot */}
                {isTriggerNode && !isProblem && (
                  <circle cx={node.x + NODE_W - 8} cy={node.y + 8} r={4}
                    fill={BUG_IMPACT_COLORS.triggerEdge} opacity={0.8} />
                )}

                {/* Top status accent bar */}
                <rect x={node.x + 4} y={node.y} width={NODE_W - 8} height={4} rx={2}
                  fill={c.badge} opacity={0.8} />

                {/* Start marker — top-right corner + badge */}
                {isStart && (
                  <>
                    <polygon points={`${node.x+NODE_W},${node.y} ${node.x+NODE_W-26},${node.y} ${node.x+NODE_W},${node.y+26}`}
                      fill="#3b82f6" opacity={0.95} />
                    <text x={node.x + NODE_W - 22} y={node.y + 17} fill="#fff" fontSize="11" fontWeight="bold"
                      fontFamily="sans-serif">▶</text>
                    <rect x={node.x + NODE_W - 74} y={node.y + 4} width={42} height={18} rx={4}
                      fill="#3b82f6" opacity={0.15} />
                    <text x={node.x + NODE_W - 53} y={node.y + 16} textAnchor="middle"
                      fill="#3b82f6" fontSize="10" fontWeight={700}
                      fontFamily="var(--font-family-ui)">{t('graph.start')}</text>
                  </>
                )}

                {/* End marker — full-width bottom bar */}
                {isEnd && (
                  <>
                    <rect x={node.x + 4} y={node.y + node.h - 6} width={NODE_W - 8} height={6} rx={3}
                      fill="#9ca3af" opacity={0.5} />
                    <rect x={node.x + NODE_W / 2 - 20} y={node.y + node.h - 24} width={40} height={18} rx={4}
                      fill="#9ca3af" opacity={0.15} />
                    <text x={node.x + NODE_W / 2} y={node.y + node.h - 11} textAnchor="middle"
                      fill="#9ca3af" fontSize="11" fontWeight={700}
                      fontFamily="var(--font-family-ui)">{t('graph.end')}</text>
                  </>
                )}

                {/* Left accent bar */}
                <rect x={node.x} y={node.y + 8} width={4} height={node.h - 16} rx={2}
                  fill={c.badge} opacity={0.8} />

                {/* Status icon */}
                <text x={node.x + 16} y={lineY} textAnchor="middle"
                  fill={c.badge} fontSize="14" fontWeight="bold">{c.icon}</text>

                {/* Label — foreignObject for auto-wrap */}
                <foreignObject x={node.x + 34} y={lineY - 12} width={NODE_W - 42} height={labelLen * 17 + 2}>
                  <div style={{
                    color: c.text, fontSize: 13, fontWeight: 600,
                    fontFamily: 'var(--font-family-ui)',
                    lineHeight: '17px', wordBreak: 'break-word', overflowWrap: 'break-word',
                    display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}>
                    {node.label}
                  </div>
                </foreignObject>

                {/* Status label — inline row below label */}
                {(() => {
                  const sl = STATUS_LABELS[node.status];
                  if (!sl) return null;
                  const sy = lineY + labelLen * 16;
                  return (
                    <text x={node.x + 14} y={sy}
                      fill={c.badge} fontSize="10" fontWeight={600}
                      fontFamily="var(--font-family-ui)" opacity={0.85}>{sl}</text>
                  );
                })()}

                {/* Kind */}
                {node.kind && (
                  <text x={node.x + 14} y={lineY + labelLen * 16 + 14}
                    fill={c.badge} fontSize="10" fontFamily="var(--font-family-mono)" opacity={0.7}>{node.kind}</text>
                )}

                {/* File */}
                {node.file && (
                  <text x={node.x + 14} y={lineY + labelLen * 16 + 14 + (node.kind ? 14 : 0)}
                    fill="#9ca3af" fontSize="10" fontFamily="var(--font-family-mono)" opacity={0.7}>
                    {node.file.length > 36 ? '…' + node.file.slice(-35) : node.file}{node.line ? `:${node.line}` : ''}
                  </text>
                )}

                {/* Detail — foreignObject for auto-wrap */}
                {node.detail && (
                  (() => {
                    const detailY = lineY + labelLen * 16 + 14 + (node.kind ? 14 : 0) + (node.file ? 14 : 0);
                    const detailW = NODE_W - 28;
                    const dcjk = ((node.detail.match(/[一-鿿]/g) || []).length) * 11;
                    const dasc = (node.detail.replace(/[一-鿿]/g, '').length) * 6;
                    const dlines = Math.max(1, Math.ceil((dcjk + dasc) / detailW));
                    const detailH = dlines * 15 + 12;
                    return (
                      <foreignObject x={node.x + 14} y={detailY} width={detailW} height={detailH}>
                        <div style={{
                          color: '#6b7280', fontSize: 11,
                          fontFamily: 'var(--font-family-ui)',
                          lineHeight: '15px', wordBreak: 'break-word', overflowWrap: 'break-word',
                        }}>
                          {node.detail}
                        </div>
                      </foreignObject>
                    );
                  })()
                )}

              </g>
            );
          })}
        </g>
      </svg>

      {/* Group filter dropdown — top right (only when multiple entry points) */}
      {entryGroups.length > 1 && (
        <div className="absolute top-3 right-3 z-10">
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium outline-none appearance-none cursor-pointer"
            style={{
              background: '#ffffffdd', backdropFilter: 'blur(8px)',
              border: '1px solid var(--color-border-default)',
              color: 'var(--color-text-secondary)',
              boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
              paddingRight: 28,
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M3 5l3 3 3-3' fill='none' stroke='%236b7280' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 8px center',
            }}
          >
            <option value="all">全部 ({graph?.nodes.length || 0})</option>
            {entryGroups.map(g => (
              <option key={g.id} value={g.id}>{g.label} ({g.members.size})</option>
            ))}
          </select>
        </div>
      )}

      {/* Legend — bottom left */}
      {graph && graph.nodes.length > 0 && (
        <div className="absolute bottom-4 left-4 rounded-xl px-4 py-2.5 flex gap-4 flex-wrap"
          style={{ background: '#ffffffdd', backdropFilter: 'blur(8px)', border: '1px solid var(--color-border-default)', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          {[
            { key: 'existing', label: t('graph.existingCode'), count: statusCounts.existing || 0 },
            { key: 'problem', label: t('graph.problemToFix'), count: (statusCounts.problem || 0) + (statusCounts.planned_change || 0) },
            { key: 'planned_new', label: t('graph.new'), count: statusCounts.planned_new || 0 },
            { key: 'done', label: t('graph.completed'), count: statusCounts.done || 0 },
          ]
          .filter(item => item.count > 0 || item.key === 'existing')
          .map(({ key, label, count }) => {
            const c = STATUS_COLORS[key as NodeStatus] || STATUS_COLORS.existing;
            return (
              <div key={key} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c.badge }}/>
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
                {count > 0 && <span className="text-caption" style={{ color: '#9ca3af' }}>({count})</span>}
              </div>
            );
          })}
          {/* Start/End markers */}
          <div className="w-px h-4 self-center" style={{ background: '#d0d5dd' }}/>
          <div className="flex items-center gap-1.5">
            <span className="text-caption" style={{ color: '#3b82f6' }}>▶ {t('graph.start')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-caption" style={{ color: '#9ca3af' }}>━ {t('graph.end')}</span>
          </div>
          {/* Edge legend */}
          <div className="w-px h-4 self-center" style={{ background: '#d0d5dd' }}/>
          {[
            { key: 'existing', label: t('graph.call'), color: EDGE_COLORS.existing },
            { key: 'error', label: t('graph.error'), color: EDGE_COLORS.error },
            { key: 'new', label: t('graph.new'), color: EDGE_COLORS.new },
          ].map(({ key, label, color }) => (
            <div key={`e-${key}`} className="flex items-center gap-1.5">
              <svg width="20" height="10"><line x1="0" y1="5" x2="14" y2="5" stroke={color} strokeWidth={key === 'error' ? 2 : 1.5} strokeDasharray={key === 'removed' ? '4,3' : undefined} strokeLinecap="round"/><polygon points="14,2 18,5 14,8" fill={color}/></svg>
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
            </div>
          ))}
          {/* Bug impact legend */}
          {(impactView.triggerEdges.size > 0 || impactView.affectedNodes.size > 0) && (
            <>
              <div className="w-px h-4 self-center" style={{ background: '#d0d5dd' }} />
              <div className="flex items-center gap-1.5">
                <svg width="20" height="10"><line x1="0" y1="5" x2="14" y2="5" stroke={BUG_IMPACT_COLORS.triggerEdge} strokeWidth={BUG_IMPACT_COLORS.triggerEdgeWidth} strokeLinecap="round"/><polygon points="14,2 18,5 14,8" fill={BUG_IMPACT_COLORS.triggerEdge}/></svg>
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{t('graph.triggerPath')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm border-dashed" style={{ border: `1.5px dashed ${BUG_IMPACT_COLORS.affectedBorder}`, background: BUG_IMPACT_COLORS.affectedBg }} />
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{t('graph.affectedNode')}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
export default memo(MapCanvas);