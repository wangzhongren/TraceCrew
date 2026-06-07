import { useRef, useEffect, useState, useCallback } from 'react';

/* ═══════════════════════════════════════════════════════════
   Call Graph Canvas — Node-Link diagram for code structure
   Used by Planner to communicate call chains and problems.
   Updated during execution to show changes.
   ═══════════════════════════════════════════════════════════ */

/* ── Data types (matching Planner's JSON output) ── */

export interface GraphNode {
  id: string;         // unique id, e.g. "auth.login"
  label: string;      // display name
  kind: 'file' | 'function' | 'class' | 'module' | 'endpoint';
  status: 'existing' | 'problem' | 'planned_change' | 'planned_new' | 'done';
  detail: string;     // brief description
  file?: string;      // source file path
  line?: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  label: string;      // "calls" | "imports" | "returns" | "creates"
  status: 'existing' | 'new' | 'removed';
}

export interface CallGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface Props {
  graph: CallGraph | null;
  phase: 'idle' | 'planning' | 'executing' | 'reviewing' | 'done' | 'rejected';
}

/* ── Colors ── */
const STATUS_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  existing:       { fill: '#161616', stroke: '#78a9ff', text: '#f4f4f4' },
  problem:        { fill: '#2a0a0a', stroke: '#da1e28', text: '#ffb3b8' },
  planned_change: { fill: '#1a1a00', stroke: '#f1c21b', text: '#f1c21b' },
  planned_new:    { fill: '#061832', stroke: '#24a148', text: '#6fdc8c' },
  done:           { fill: '#071a10', stroke: '#24a148', text: '#6fdc8c' },
};

const EDGE_COLORS: Record<string, string> = {
  existing: '#393939',
  new: '#24a148',
  removed: '#da1e28',
};

/* ── Simple layered layout ── */
interface LayoutNode extends GraphNode {
  x: number; y: number;
}

function layoutGraph(graph: CallGraph): { nodes: LayoutNode[]; edges: GraphEdge[] } {
  const nodes = graph.nodes;
  const edges = graph.edges;

  if (nodes.length === 0) return { nodes: [], edges };

  // Simple BFS layering from root nodes
  const layers: Map<string, number> = new Map();
  const children: Map<string, string[]> = new Map();

  for (const n of nodes) children.set(n.id, []);
  for (const e of edges) {
    const c = children.get(e.from);
    if (c) c.push(e.to);
  }

  // Root nodes: nodes with no incoming edges
  const incoming = new Set<string>();
  for (const e of edges) incoming.add(e.to);

  let queue = nodes.filter((n) => !incoming.has(n.id));
  if (queue.length === 0) queue = [nodes[0]]; // fallback

  const visited = new Set<string>();
  queue.forEach((n) => { layers.set(n.id, 0); visited.add(n.id); });

  while (queue.length > 0) {
    const next: GraphNode[] = [];
    for (const n of queue) {
      const layer = layers.get(n.id) || 0;
      for (const childId of (children.get(n.id) || [])) {
        if (!visited.has(childId)) {
          visited.add(childId);
          const child = nodes.find((x) => x.id === childId);
          if (child) {
            layers.set(childId, layer + 1);
            next.push(child);
          }
        }
      }
    }
    // Also process any remaining nodes without incoming
    for (const n of nodes) {
      if (!visited.has(n.id)) {
        visited.add(n.id);
        layers.set(n.id, (layers.get(n.id) || 0) + 1);
        next.push(n);
      }
    }
    queue = next;
  }

  // Assign positions
  const layerGroups: Map<number, GraphNode[]> = new Map();
  for (const [id, l] of layers) {
    const n = nodes.find((x) => x.id === id);
    if (n) {
      const group = layerGroups.get(l) || [];
      group.push(n);
      layerGroups.set(l, group);
    }
  }

  const layouted: LayoutNode[] = [];
  const NODE_W = 200, NODE_H = 60;
  const X_GAP = 40, Y_GAP = 80;

  for (const [layer, group] of layerGroups) {
    const totalW = group.length * (NODE_W + X_GAP) - X_GAP;
    const startX = -totalW / 2;
    group.forEach((n, i) => {
      layouted.push({
        ...n,
        x: startX + i * (NODE_W + X_GAP),
        y: layer * (NODE_H + Y_GAP),
      });
    });
  }

  return { nodes: layouted, edges };
}

/* ══════════════════════════════════════════════════ */

export default function MapCanvas({ graph, phase }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // Layout the graph
  const layouted = graph ? layoutGraph(graph) : { nodes: [], edges: [] };

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setTransform((t) => ({
      ...t,
      scale: Math.max(0.3, Math.min(2, t.scale + delta)),
    }));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === svgRef.current || (e.target as SVGElement)?.tagName === 'svg') {
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
    }
  }, [transform]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setTransform((t) => ({ ...t, x: dragStart.current.tx + dx, y: dragStart.current.ty + dy }));
  }, [dragging]);

  const handleMouseUp = useCallback(() => setDragging(false), []);

  // Center on mount or graph change
  useEffect(() => {
    setTransform({ x: 400, y: 200, scale: 1 });
  }, [graph]);

  /* ── Render ── */
  return (
    <div className="relative h-full overflow-hidden" style={{ background: 'var(--ibm-bg)', cursor: dragging ? 'grabbing' : 'grab' }}>
      {/* Grid background */}
      <svg className="absolute inset-0 pointer-events-none opacity-[0.03]" width="100%" height="100%">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="20" cy="20" r="1" fill="var(--ibm-text)"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)"/>
      </svg>

      {/* Empty state */}
      {(!graph || graph.nodes.length === 0) && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center space-y-3">
            <svg width="48" height="48" viewBox="0 0 32 32" fill="none" stroke="var(--ibm-text-placeholder)" strokeWidth="1" style={{ margin: '0 auto' }}>
              <circle cx="7" cy="7" r="2"/><circle cx="25" cy="7" r="2"/><circle cx="16" cy="20" r="2"/>
              <circle cx="10" cy="25" r="2"/><circle cx="22" cy="25" r="2"/>
              <line x1="9" y1="8" x2="15" y2="19"/><line x1="23" y1="8" x2="17" y2="19"/>
              <line x1="9.5" y1="25" x2="15" y2="21"/><line x1="21.5" y1="25" x2="17" y2="21"/>
            </svg>
            <p className="text-sm font-light" style={{ color: 'var(--ibm-text-placeholder)' }}>
              {phase === 'idle' ? 'Call graph will appear when Planner analyzes the code' :
               phase === 'planning' ? 'Planner is analyzing call chains...' : 'No graph yet'}
            </p>
            <p className="text-xs" style={{ color: 'var(--ibm-text-disabled)' }}>
              Shows code structure, call relationships, and problem locations
            </p>
          </div>
        </div>
      )}

      {/* SVG canvas — zoom + pan */}
      <svg ref={svgRef} className="absolute inset-0 w-full h-full"
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

            const cx1 = from.x + 100; const cy1 = from.y + 60;
            const cx2 = to.x + 100; const cy2 = to.y;

            // Arrow head
            const midX = (cx1 + cx2) / 2;
            const midY = (cy1 + cy2) / 2;

            return (
              <g key={`e${i}`}>
                {/* Edge line */}
                <path d={`M${cx1},${cy1} C${cx1},${(cy1+cy2)/2} ${cx2},${(cy1+cy2)/2} ${cx2},${cy2-5}`}
                  fill="none" stroke={EDGE_COLORS[edge.status] || EDGE_COLORS.existing}
                  strokeWidth={edge.status === 'new' ? 2 : 1}
                  strokeDasharray={edge.status === 'removed' ? '4,3' : undefined} />
                {/* Arrow head */}
                <polygon
                  points={`${cx2-5},${cy2-10} ${cx2+5},${cy2-10} ${cx2},${cy2-5}`}
                  fill={EDGE_COLORS[edge.status] || EDGE_COLORS.existing}/>
                {/* Edge label */}
                <text x={midX} y={midY - 4} textAnchor="middle"
                  fill="var(--ibm-text-placeholder)" fontSize="10" fontFamily="var(--ibm-font)"
                  style={{ pointerEvents: 'none' }}>
                  {edge.label}
                </text>
              </g>
            );
          })}

          {/* Nodes */}
          {layouted.nodes.map((node) => {
            const c = STATUS_COLORS[node.status] || STATUS_COLORS.existing;
            const isSelected = selectedNode === node.id;
            const opacity = selectedNode && !isSelected ? 0.3 : 1;

            return (
              <g key={node.id} style={{ cursor: 'pointer', opacity }}
                onClick={() => setSelectedNode(isSelected ? null : node.id)}>
                {/* Node background */}
                <rect x={node.x} y={node.y} width={200} height={60} rx={6}
                  fill={c.fill} stroke={c.stroke} strokeWidth={isSelected ? 2 : 1}
                  style={{ transition: 'opacity 0.2s' }} />

                {/* Kind badge */}
                <rect x={node.x + 8} y={node.y + 8} width={16} height={16} rx={3}
                  fill={c.stroke} opacity={0.3}/>
                <text x={node.x + 16} y={node.y + 19} textAnchor="middle"
                  fill={c.stroke} fontSize="8" fontFamily="var(--ibm-font)" fontWeight="bold">
                  {node.kind === 'function' ? 'ƒ' :
                   node.kind === 'class' ? 'C' :
                   node.kind === 'endpoint' ? '→' :
                   node.kind === 'module' ? 'M' : 'F'}
                </text>

                {/* Label */}
                <text x={node.x + 30} y={node.y + 22}
                  fill={c.text} fontSize="12" fontFamily="var(--ibm-font)" fontWeight="500">
                  {node.label.length > 18 ? node.label.slice(0, 17) + '…' : node.label}
                </text>

                {/* File path */}
                {node.file && (
                  <text x={node.x + 30} y={node.y + 38}
                    fill="var(--ibm-text-placeholder)" fontSize="9" fontFamily="var(--ibm-font-mono)"
                    opacity={0.7}>
                    {node.file.slice(-25)}
                  </text>
                )}

                {/* Detail — visible on selected */}
                {isSelected && node.detail && (
                  <text x={node.x + 10} y={node.y + 78}
                    fill="var(--ibm-text-secondary)" fontSize="10" fontFamily="var(--ibm-font)">
                    {node.detail.slice(0, 60)}
                  </text>
                )}

                {/* Status indicator dot */}
                {node.status !== 'existing' && (
                  <circle cx={node.x + 190} cy={node.y + 12} r={5}
                    fill={c.stroke} opacity={0.8} />
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Legend */}
      {graph && graph.nodes.length > 0 && (
        <div className="absolute bottom-4 left-4 flex gap-3 p-3 rounded-lg" style={{ background: 'var(--ibm-layer)', border: '1px solid var(--ibm-border-subtle)' }}>
          {Object.entries(STATUS_COLORS).map(([key, c]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded" style={{ background: c.stroke }}/>
              <span className="text-[10px]" style={{ color: 'var(--ibm-text-secondary)' }}>
                {key === 'existing' ? 'Code' :
                 key === 'problem' ? 'Issue' :
                 key === 'planned_change' ? 'Changes' :
                 key === 'planned_new' ? 'New' : 'Done'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
