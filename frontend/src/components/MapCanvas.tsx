import { useRef, useEffect, useState, useCallback, useMemo } from 'react';

/* ═══════════════════════════════════════════════════════════
   Call Graph Canvas — Node-Link diagram for code structure
   ═══════════════════════════════════════════════════════════ */

export interface GraphNode {
  id: string;
  label: string;
  kind: string;
  status: 'existing' | 'problem' | 'planned_change' | 'planned_new' | 'done';
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
}

/* ── Color palette ── */
const COLORS: Record<string, { fill: string; stroke: string; badge: string; text: string; icon: string }> = {
  existing:       { fill: '#1a1f2e', stroke: '#5a8fd4', badge: '#5a8fd4', text: '#c8d6e5', icon: '⬡' },
  problem:        { fill: '#2e1a1a', stroke: '#e0556a', badge: '#e0556a', text: '#f0c0c5', icon: '✕' },
  planned_change: { fill: '#292614', stroke: '#e0b830', badge: '#e0b830', text: '#f0e0b0', icon: '✎' },
  planned_new:    { fill: '#0f291a', stroke: '#3db86c', badge: '#3db86c', text: '#b8e6cc', icon: '+' },
  done:           { fill: '#0f291a', stroke: '#3db86c', badge: '#3db86c', text: '#b8e6cc', icon: '✓' },
};

const EDGE_COLORS: Record<string, string> = {
  existing: '#4a5568',
  new: '#3db86c',
  removed: '#e0556a',
  error: '#e0556a',
};

/* ── Dagre-like layered layout ── */
interface LayoutNode extends GraphNode {
  x: number; y: number;
}

const NODE_W = 220, NODE_H = 72;
const X_GAP = 48, Y_GAP = 96;

function layoutGraph(graph: CallGraph): { nodes: LayoutNode[]; edges: GraphEdge[] } {
  const { nodes, edges } = graph;
  if (nodes.length === 0) return { nodes: [], edges };

  // Build adjacency
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const n of nodes) {
    children.set(n.id, []);
    parents.set(n.id, []);
  }
  for (const e of edges) {
    children.get(e.from)?.push(e.to);
    parents.get(e.to)?.push(e.from);
  }

  // Kahn's algorithm for layering
  const layer = new Map<string, number>();
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n.id, parents.get(n.id)?.length || 0);

  const queue: string[] = [];
  for (const n of nodes) {
    if (inDegree.get(n.id) === 0) {
      layer.set(n.id, 0);
      queue.push(n.id);
    }
  }
  if (queue.length === 0) {
    // All nodes in a cycle — put first as root
    layer.set(nodes[0].id, 0);
    queue.push(nodes[0].id);
  }

  while (queue.length > 0) {
    const id = queue.shift()!;
    const currentLayer = layer.get(id) || 0;
    for (const child of children.get(id) || []) {
      const nd = Math.max(layer.get(child) || 0, currentLayer + 1);
      layer.set(child, nd);
      const deg = (inDegree.get(child) || 1) - 1;
      inDegree.set(child, deg);
      if (deg === 0 && !queue.includes(child)) queue.push(child);
    }
  }

  // Catch unvisited nodes
  for (const n of nodes) {
    if (!layer.has(n.id)) layer.set(n.id, 0);
  }

  // Group by layer
  const layerGroups = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const l = layer.get(n.id) || 0;
    const g = layerGroups.get(l) || [];
    g.push(n);
    layerGroups.set(l, g);
  }

  // Assign positions — left to right, top to bottom
  const layouted: LayoutNode[] = [];
  const sortedLayers = [...layerGroups.keys()].sort((a, b) => a - b);

  for (const l of sortedLayers) {
    const group = layerGroups.get(l)!;
    const totalW = group.length * (NODE_W + X_GAP) - X_GAP;
    const startX = -totalW / 2;
    group.forEach((n, i) => {
      layouted.push({ ...n, x: startX + i * (NODE_W + X_GAP), y: l * (NODE_H + Y_GAP) });
    });
  }

  return { nodes: layouted, edges };
}

/* ══════════════════════════════════════════════════ */

export default function MapCanvas({ graph, phase }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ x: 60, y: 40, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const layouted = useMemo(
    () => graph ? layoutGraph(graph) : { nodes: [] as LayoutNode[], edges: [] as GraphEdge[] },
    [graph]
  );

  // Auto-fit on new graph
  useEffect(() => {
    if (!graph || graph.nodes.length === 0) return;
    setTransform({ x: 60, y: 40, scale: 0.85 });
    setSelectedNode(null);
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
          {layouted.edges.map((edge, i) => {
            const from = layouted.nodes.find((n) => n.id === edge.from);
            const to = layouted.nodes.find((n) => n.id === edge.to);
            if (!from || !to) return null;

            const x1 = from.x + NODE_W / 2;
            const y1 = from.y + NODE_H;
            const x2 = to.x + NODE_W / 2;
            const y2 = to.y;
            const ec = EDGE_COLORS[edge.status] || EDGE_COLORS.existing;
            const isError = edge.status === 'error';
            const isNew = edge.status === 'new';

            return (
              <g key={`e${i}`}>
                {/* Glow for error/new edges */}
                {(isError || isNew) && (
                  <path d={`M${x1},${y1} L${x1},${(y1+y2)/2} L${x2},${(y1+y2)/2} L${x2},${y2-8}`}
                    fill="none" stroke={ec} strokeWidth={4} opacity={0.25} />
                )}
                {/* Main edge line — orthogonal */}
                <path d={`M${x1},${y1} L${x1},${(y1+y2)/2} L${x2},${(y1+y2)/2} L${x2},${y2-8}`}
                  fill="none" stroke={ec}
                  strokeWidth={isError || isNew ? 2 : 1.2}
                  strokeDasharray={edge.status === 'removed' ? '6,4' : undefined}
                  opacity={edge.status === 'removed' ? 0.5 : 0.85} />
                {/* Arrow head */}
                <polygon
                  points={`${x2-5},${y2-10} ${x2+5},${y2-10} ${x2},${y2-3}`}
                  fill={ec} opacity={0.85} />
                {/* Edge label */}
                {edge.label && (
                  <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6} textAnchor="middle"
                    fill="#8b949e" fontSize="10" fontFamily="monospace" fontWeight={isError ? 700 : 400}>
                    <tspan fill={isError ? '#e0556a' : '#8b949e'}>{edge.label}</tspan>
                  </text>
                )}
              </g>
            );
          })}

          {/* Nodes */}
          {layouted.nodes.map((node) => {
            const c = COLORS[node.status] || COLORS.existing;
            const isSelected = selectedNode === node.id;
            const isHovered = hoveredNode === node.id;
            const dimmed = selectedNode && !isSelected;
            const isProblem = node.status === 'problem';

            return (
              <g key={node.id} style={{ cursor: 'pointer', transition: 'opacity 0.2s', opacity: dimmed ? 0.25 : 1 }}
                onClick={() => setSelectedNode(isSelected ? null : node.id)}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}>

                {/* Problem glow */}
                {isProblem && (
                  <rect x={node.x - 4} y={node.y - 4} width={NODE_W + 8} height={NODE_H + 8} rx={10}
                    fill="none" stroke={c.stroke} strokeWidth={2} opacity={0.2 + (isHovered ? 0.15 : 0)}
                    style={{ transition: 'opacity 0.3s' }} />
                )}

                {/* Card background */}
                <rect x={node.x} y={node.y} width={NODE_W} height={NODE_H} rx={8}
                  fill={c.fill} stroke={isHovered || isSelected ? c.stroke : c.badge}
                  strokeWidth={isSelected ? 2.5 : isHovered ? 1.8 : 1}
                  strokeOpacity={isHovered || isSelected ? 1 : 0.5}
                  style={{ filter: isSelected ? 'brightness(1.2)' : undefined }} />

                {/* Left accent bar */}
                <rect x={node.x} y={node.y + 8} width={3} height={NODE_H - 16} rx={1.5}
                  fill={c.badge} opacity={0.8} />

                {/* Status icon */}
                <text x={node.x + 16} y={node.y + 24} textAnchor="middle"
                  fill={c.badge} fontSize="13" fontWeight="bold">
                  {c.icon}
                </text>

                {/* Label — 16 chars max, 13px font */}
                <text x={node.x + 34} y={node.y + 24}
                  fill={c.text} fontSize="13" fontFamily="system-ui, sans-serif" fontWeight={600}>
                  {node.label.length > 16 ? node.label.slice(0, 15) + '…' : node.label}
                </text>

                {/* File path — below label */}
                {node.file && (
                  <text x={node.x + 34} y={node.y + 42}
                    fill="#8b949e" fontSize="10" fontFamily="monospace" opacity={0.8}>
                    {node.file.length > 28 ? '…' + node.file.slice(-27) : node.file}
                  </text>
                )}

                {/* Detail — bottom of card */}
                {node.detail && (
                  <text x={node.x + 16} y={node.y + NODE_H - 16}
                    fill="#6e7681" fontSize="10" fontFamily="system-ui, sans-serif">
                    {node.detail.length > 32 ? node.detail.slice(0, 31) + '…' : node.detail}
                  </text>
                )}

                {/* Status badge — top right */}
                {node.status !== 'existing' && (
                  <rect x={node.x + NODE_W - 58} y={node.y + 8} width={52} height={16} rx={8}
                    fill={c.badge} opacity={0.2} />
                )}
                {node.status !== 'existing' && (
                  <text x={node.x + NODE_W - 32} y={node.y + 19} textAnchor="middle"
                    fill={c.badge} fontSize="9" fontWeight={700}>
                    {node.status === 'problem' ? 'ISSUE' :
                     node.status === 'planned_change' ? 'CHANGE' :
                     node.status === 'planned_new' ? 'NEW' : 'DONE'}
                  </text>
                )}

                {/* Selected detail popup */}
                {isSelected && (
                  <g>
                    <rect x={node.x + NODE_W + 12} y={node.y} width={210} height={NODE_H}
                      rx={6} fill="#161b22" stroke={c.stroke} strokeWidth={1} opacity={0.95} />
                    <text x={node.x + NODE_W + 22} y={node.y + 20}
                      fill={c.text} fontSize="12" fontWeight={600}>
                      {node.kind}
                    </text>
                    <text x={node.x + NODE_W + 22} y={node.y + 38}
                      fill="#8b949e" fontSize="11">
                      {node.detail?.slice(0, 55)}
                    </text>
                    {node.file && (
                      <text x={node.x + NODE_W + 22} y={node.y + 56}
                        fill="#6e7681" fontSize="10" fontFamily="monospace">
                        {node.file.length > 32 ? '…' + node.file.slice(-31) : node.file}
                      </text>
                    )}
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Legend — bottom left */}
      {graph && graph.nodes.length > 0 && (
        <div className="absolute bottom-4 left-4 rounded-xl px-4 py-2.5 flex gap-4 flex-wrap"
          style={{ background: '#161b22dd', backdropFilter: 'blur(8px)', border: '1px solid #30363d' }}>
          {[
            { key: 'existing', label: '现有代码', count: statusCounts.existing || 0 },
            { key: 'problem', label: '问题位置', count: statusCounts.problem || 0 },
            { key: 'planned_change', label: '需要修改', count: statusCounts.planned_change || 0 },
            { key: 'planned_new', label: '新增', count: statusCounts.planned_new || 0 },
            { key: 'done', label: '已完成', count: statusCounts.done || 0 },
          ]
          .filter(item => item.count > 0 || item.key === 'existing')
          .map(({ key, label, count }) => {
            const c = COLORS[key];
            return (
              <div key={key} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: c.badge }}/>
                <span className="text-[11px]" style={{ color: '#c9d1d9' }}>{label}</span>
                {count > 0 && <span className="text-[10px]" style={{ color: '#6e7681' }}>({count})</span>}
              </div>
            );
          })}
          {/* Edge legend */}
          <div className="w-px h-4 self-center" style={{ background: '#30363d' }}/>
          {[
            { key: 'existing', label: '调用', color: EDGE_COLORS.existing },
            { key: 'error', label: '异常', color: EDGE_COLORS.error },
            { key: 'new', label: '新增', color: EDGE_COLORS.new },
          ].map(({ key, label, color }) => (
            <div key={`e-${key}`} className="flex items-center gap-1.5">
              <svg width="20" height="10"><line x1="0" y1="5" x2="14" y2="5" stroke={color} strokeWidth={key === 'error' ? 2 : 1.2} strokeDasharray={key === 'removed' ? '4,3' : undefined}/><polygon points="14,2 18,5 14,8" fill={color}/></svg>
              <span className="text-[11px]" style={{ color: '#c9d1d9' }}>{label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
