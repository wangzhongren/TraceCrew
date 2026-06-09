import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import dagre from 'dagre';
import { STATUS_COLORS, EDGE_COLORS, STATUS_LABELS } from '../types/theme';
import type { NodeStatus } from '../types/theme';

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

interface Props {
  graph: CallGraph | null;
  phase: 'idle' | 'planning' | 'executing' | 'reviewing' | 'done' | 'rejected';
  selectedNode: string | null;
  onSelectNode: (id: string | null) => void;
}

/* ── Dagre layered layout ── */
interface LayoutNode extends GraphNode {
  x: number; y: number; h: number;
}

const NODE_W = 280;
const X_GAP = 56, Y_GAP = 60;

/** Estimate node height from content length (label auto-wraps in foreignObject) */
function calcNodeHeight(n: GraphNode): number {
  const labelW = NODE_W - 42;
  const estCharsPerLine = Math.floor(labelW / 10);
  const labelLines = Math.ceil(n.label.length / estCharsPerLine);
  const hasFile = !!n.file;
  const hasKind = !!n.kind;
  const hasDetail = !!n.detail;
  let h = 28 + labelLines * 17 + 16;
  h += 14; // status label row
  if (hasKind) h += 14;
  if (hasFile) h += 14;
  if (hasDetail) h += 48;
  return Math.max(h, 76);
}

const VIRTUAL_ROOT = '__vr__';

function layoutGraph(graph: CallGraph): { nodes: LayoutNode[]; edges: (GraphEdge & { back?: boolean })[] } {
  const { nodes, edges } = graph;
  if (nodes.length === 0) return { nodes: [], edges };

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: X_GAP, ranksep: Y_GAP });
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

export default function MapCanvas({ graph, phase, selectedNode, onSelectNode }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 60, y: 40, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const layouted = useMemo(
    () => graph ? layoutGraph(graph) : { nodes: [] as LayoutNode[], edges: [] as GraphEdge[] },
    [graph]
  );

  // Auto-fit on new graph
  useEffect(() => {
    if (!graph || graph.nodes.length === 0) return;
    setTransform({ x: 60, y: 40, scale: 0.85 });
    onSelectNode(null);
  }, [graph]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.12 : 0.12;
    setTransform((t) => ({ ...t, scale: Math.max(0.2, Math.min(2.5, t.scale + delta)) }));
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

  return (
    <div ref={containerRef} className="relative h-full overflow-hidden" style={{ background: '#0d1117' }}>
      {/* Background dot grid */}
      <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
        <defs>
          <pattern id="dotGrid" width="32" height="32" patternUnits="userSpaceOnUse">
            <circle cx="16" cy="16" r="0.8" fill="#ffffff" opacity="0.04"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dotGrid)"/>
      </svg>

      {/* Empty state */}
      {(!graph || graph.nodes.length === 0) && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'transparent' }}>
          <div className="text-center space-y-3">
            <div className="text-4xl opacity-20">◈</div>
            <p className="text-sm font-light" style={{ color: '#8b949e' }}>
              {phase === 'idle' ? 'Call graph will appear when Mapper analyzes the code' :
               phase === 'planning' ? 'Mapper is analyzing call chains...' : 'No graph yet'}
            </p>
          </div>
        </div>
      )}

      {/* SVG canvas */}
      <svg ref={svgRef} className="absolute inset-0 w-full h-full bg-layer"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}>

        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}>
          {/* Edges */}
          {layouted.edges.map((edge: any, i: number) => {
            const from = layouted.nodes.find((n) => n.id === edge.from);
            const to = layouted.nodes.find((n) => n.id === edge.to);
            if (!from || !to) return null;
            const edgeConnected = selectedNode
              ? new Set([selectedNode, ...layouted.edges.filter((e: any) => e.from === selectedNode || e.to === selectedNode).flatMap((e: any) => [e.from, e.to])])
              : null;
            const edgeDimmed = edgeConnected && !(edgeConnected.has(edge.from) && edgeConnected.has(edge.to));

            const ec = EDGE_COLORS[edge.status] || EDGE_COLORS.existing;
            const isError = edge.status === 'error';
            const isNew = edge.status === 'new';
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
                    fill="none" stroke="#e0556a" strokeWidth={1.5}
                    strokeDasharray="6,3" opacity={0.6} />
                  <polygon points={`${tx-6},${ty-4} ${tx-2},${ty} ${tx-6},${ty+4}`}
                    fill="#e0556a" opacity={0.7} />
                  <text x={midX - 4} y={(sy + ty) / 2 - 6} textAnchor="end"
                    fill="#e0556a" fontSize="9" fontFamily="var(--font-family-ui)" opacity={0.6}>
                    ↩ {edge.label || 'feedback'}
                  </text>
                </g>
              );
            }

            const x1 = from.x + NODE_W / 2;
            const y1 = from.y + from.h;
            const x2 = to.x + NODE_W / 2;
            const y2 = to.y;

            return (
              <g key={`e${i}`} style={{ opacity: edgeDimmed ? 0.12 : 1, transition: 'opacity 0.3s' }}>
                {(isError || isNew) && (
                  <path d={`M${x1},${y1} L${x1},${(y1+y2)/2} L${x2},${(y1+y2)/2} L${x2},${y2-8}`}
                    fill="none" stroke={ec} strokeWidth={4} opacity={0.25} />
                )}
                <path d={`M${x1},${y1} L${x1},${(y1+y2)/2} L${x2},${(y1+y2)/2} L${x2},${y2-8}`}
                  fill="none" stroke={ec}
                  strokeWidth={isError || isNew ? 2 : 1.2}
                  strokeDasharray={edge.status === 'removed' ? '6,4' : undefined}
                  opacity={edge.status === 'removed' ? 0.5 : 0.85} />
                <polygon
                  points={`${x2-5},${y2-10} ${x2+5},${y2-10} ${x2},${y2-3}`}
                  fill={ec} opacity={0.85} />
                {edge.label && (
                  <text x={(x1+x2)/2} y={(y1+y2)/2 - 6} textAnchor="middle"
                    fill="#8b949e" fontSize="9" fontFamily="var(--font-family-ui)">
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
              <g key={node.id} style={{ cursor: 'pointer', transition: 'opacity 0.2s', opacity: dimmed ? 0.25 : 1 }}
                onClick={() => onSelectNode(isSelected ? null : node.id)}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}>

                {/* Problem glow */}
                {isProblem && (
                  <rect x={node.x - 4} y={node.y - 4} width={NODE_W + 8} height={node.h + 8} rx={10}
                    fill="none" stroke={c.stroke} strokeWidth={2} opacity={0.2 + (isHovered ? 0.15 : 0)}
                    style={{ transition: 'opacity 0.3s' }} />
                )}

                {/* Card background */}
                <rect x={node.x} y={node.y} width={NODE_W} height={node.h} rx={8}
                  fill={c.fill} stroke={isHovered || isSelected ? c.stroke : c.badge}
                  strokeWidth={isSelected ? 2.5 : isHovered ? 1.8 : 1}
                  strokeOpacity={isHovered || isSelected ? 1 : 0.5} />

                {/* Start marker — top-right corner + badge */}
                {isStart && (
                  <>
                    <polygon points={`${node.x+NODE_W},${node.y} ${node.x+NODE_W-26},${node.y} ${node.x+NODE_W},${node.y+26}`}
                      fill="#4a9eff" opacity={0.95} />
                    <text x={node.x + NODE_W - 22} y={node.y + 17} fill="#fff" fontSize="11" fontWeight="bold"
                      fontFamily="sans-serif">▶</text>
                    <rect x={node.x + NODE_W - 74} y={node.y + 4} width={42} height={18} rx={4}
                      fill="#4a9eff" opacity={0.15} />
                    <text x={node.x + NODE_W - 53} y={node.y + 16} textAnchor="middle"
                      fill="#4a9eff" fontSize="10" fontWeight={700}
                      fontFamily="var(--font-family-ui)">起点</text>
                  </>
                )}

                {/* End marker — full-width bottom bar */}
                {isEnd && (
                  <>
                    <rect x={node.x + 4} y={node.y + node.h - 6} width={NODE_W - 8} height={6} rx={3}
                      fill="#8b949e" opacity={0.5} />
                    <rect x={node.x + NODE_W / 2 - 20} y={node.y + node.h - 24} width={40} height={18} rx={4}
                      fill="#8b949e" opacity={0.15} />
                    <text x={node.x + NODE_W / 2} y={node.y + node.h - 11} textAnchor="middle"
                      fill="#8b949e" fontSize="11" fontWeight={700}
                      fontFamily="var(--font-family-ui)">终点</text>
                  </>
                )}

                {/* Left accent bar */}
                <rect x={node.x} y={node.y + 8} width={3} height={node.h - 16} rx={1.5}
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
                    fill="#8b949e" fontSize="10" fontFamily="var(--font-family-mono)" opacity={0.7}>
                    {node.file.length > 36 ? '…' + node.file.slice(-35) : node.file}{node.line ? `:${node.line}` : ''}
                  </text>
                )}

                {/* Detail — foreignObject for auto-wrap */}
                {node.detail && (
                  (() => {
                    const detailY = lineY + labelLen * 16 + 14 + (node.kind ? 14 : 0) + (node.file ? 14 : 0);
                    const detailH = node.h - detailY + node.y - 8;
                    return (
                      <foreignObject x={node.x + 14} y={detailY} width={NODE_W - 28} height={detailH}>
                        <div style={{
                          color: '#6e7681', fontSize: 11,
                          fontFamily: 'var(--font-family-ui)',
                          lineHeight: '15px', wordBreak: 'break-word', overflowWrap: 'break-word',
                          overflow: 'hidden',
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

      {/* Legend — bottom left */}
      {graph && graph.nodes.length > 0 && (
        <div className="absolute bottom-4 left-4 rounded-xl px-4 py-2.5 flex gap-4 flex-wrap"
          style={{ background: '#161b22dd', backdropFilter: 'blur(8px)', border: '1px solid var(--color-border-default)' }}>
          {[
            { key: 'existing', label: '现有代码', count: statusCounts.existing || 0 },
            { key: 'problem', label: '问题/待修复', count: (statusCounts.problem || 0) + (statusCounts.planned_change || 0) },
            { key: 'planned_new', label: '新增', count: statusCounts.planned_new || 0 },
            { key: 'done', label: '已完成', count: statusCounts.done || 0 },
          ]
          .filter(item => item.count > 0 || item.key === 'existing')
          .map(({ key, label, count }) => {
            const c = STATUS_COLORS[key as NodeStatus] || STATUS_COLORS.existing;
            return (
              <div key={key} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c.badge }}/>
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
                {count > 0 && <span className="text-caption" style={{ color: '#6e7681' }}>({count})</span>}
              </div>
            );
          })}
          {/* Start/End markers */}
          <div className="w-px h-4 self-center" style={{ background: '#30363d' }}/>
          <div className="flex items-center gap-1.5">
            <span className="text-caption" style={{ color: '#4a9eff' }}>▶ 起点</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-caption" style={{ color: '#8b949e' }}>━ 终点</span>
          </div>
          {/* Edge legend */}
          <div className="w-px h-4 self-center" style={{ background: '#30363d' }}/>
          {[
            { key: 'existing', label: '调用', color: EDGE_COLORS.existing },
            { key: 'error', label: '异常', color: EDGE_COLORS.error },
            { key: 'new', label: '新增', color: EDGE_COLORS.new },
          ].map(({ key, label, color }) => (
            <div key={`e-${key}`} className="flex items-center gap-1.5">
              <svg width="20" height="10"><line x1="0" y1="5" x2="14" y2="5" stroke={color} strokeWidth={key === 'error' ? 2 : 1.2} strokeDasharray={key === 'removed' ? '4,3' : undefined}/><polygon points="14,2 18,5 14,8" fill={color}/></svg>
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
