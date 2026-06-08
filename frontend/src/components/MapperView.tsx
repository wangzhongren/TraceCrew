import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import type { CallGraph } from './MapCanvas';

interface Props {
  graph: CallGraph | null;
  phase: string;
  onSelectNode: (id: string | null) => void;
  selectedNode: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  existing: '#4a9eff', problem: '#ff4444', planned_change: '#f0c000', planned_new: '#22c55e', done: '#22c55e',
};
const STATUS_NAMES: Record<string, string> = {
  existing: '现有', problem: '问题', planned_change: '待改', planned_new: '新增', done: '完成',
};

const NODE_W = 240, NODE_H = 64, Y_GAP = 180, X_GAP = 60;

interface TreeNode { id: string; label: string; detail?: string; children: TreeNode[]; status: string; file?: string; line?: number; depth: number }

function buildTree(rootId: string, nodes: any[], edges: any[]): TreeNode | null {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const root = nodeMap.get(rootId);
  if (!root) return null;
  const childrenMap = new Map<string, string[]>();
  for (const e of edges) { const arr = childrenMap.get(e.from) || []; arr.push(e.to); childrenMap.set(e.from, arr); }
  function walk(id: string, depth: number): TreeNode {
    const n = nodeMap.get(id)!;
    return { id, label: n.label, detail: n.detail, status: n.status, file: n.file, line: n.line, depth,
      children: (childrenMap.get(id) || []).map(cid => walk(cid, depth + 1)) };
  }
  return walk(rootId, 0);
}

export default function MapperView({ graph, phase, onSelectNode, selectedNode }: Props) {
  const [activeRoot, setActiveRoot] = useState<string | null>(null);
  const [transform, setTransform] = useState({ x: 40, y: 20, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [treeWidth, setTreeWidth] = useState(220);
  const [resizing, setResizing] = useState(false);
  const resizeRef = useRef({ startX: 0, startW: 0 });

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setResizing(true);
    resizeRef.current = { startX: e.clientX, startW: treeWidth };
  }, [treeWidth]);
  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!resizing) return;
    setTreeWidth(Math.max(150, Math.min(500, resizeRef.current.startW + (e.clientX - resizeRef.current.startX))));
  }, [resizing]);
  const handleResizeEnd = useCallback(() => setResizing(false), []);
  useEffect(() => {
    if (resizing) { window.addEventListener('mousemove', handleResizeMove); window.addEventListener('mouseup', handleResizeEnd); }
    return () => { window.removeEventListener('mousemove', handleResizeMove); window.removeEventListener('mouseup', handleResizeEnd); };
  }, [resizing, handleResizeMove, handleResizeEnd]);

  const roots = useMemo(() => {
    if (!graph || graph.nodes.length === 0) return [] as string[];
    const hasIncoming = new Set(graph.edges.map(e => e.to));
    const entries = graph.nodes.filter(n => !hasIncoming.has(n.id));
    return (entries.length > 0 ? entries : [graph.nodes[0]]).map(n => n.id);
  }, [graph]);

  const activeGraph = useMemo(() => {
    if (!graph || !activeRoot) return null;
    const visited = new Set<string>(); const queue = [activeRoot];
    while (queue.length > 0) { const id = queue.shift()!; if (visited.has(id)) continue; visited.add(id); for (const e of graph.edges) if (e.from === id && !visited.has(e.to)) queue.push(e.to); }
    return { nodes: graph.nodes.filter(n => visited.has(n.id)), edges: graph.edges.filter(e => visited.has(e.from) && visited.has(e.to)) };
  }, [graph, activeRoot]);

  const tree = useMemo(() => activeRoot ? buildTree(activeRoot, activeGraph?.nodes || [], activeGraph?.edges || []) : null, [activeRoot, activeGraph]);

  const layout = useMemo(() => {
    if (!activeGraph) return [];
    const { nodes, edges } = activeGraph;
    const layer = new Map<string, number>(); const inDeg = new Map<string, number>();
    for (const n of nodes) { layer.set(n.id, 0); inDeg.set(n.id, 0); }
    for (const e of edges) inDeg.set(e.to, (inDeg.get(e.to) || 0) + 1);
    const queue: string[] = nodes.filter(n => (inDeg.get(n.id) || 0) === 0).map(n => n.id);
    for (const id of queue) layer.set(id, 0);
    while (queue.length > 0) { const id = queue.shift()!; const l = layer.get(id)!; for (const e of edges) { if (e.from === id) { layer.set(e.to, Math.max(layer.get(e.to) || 0, l + 1)); const nd = (inDeg.get(e.to) || 1) - 1; inDeg.set(e.to, nd); if (nd === 0) queue.push(e.to); } } }
    const layers = new Map<number, string[]>(); for (const [id, l] of layer) { const arr = layers.get(l) || []; arr.push(id); layers.set(l, arr); }
    const result: Array<{ id: string; x: number; y: number }> = [];
    for (const l of [...layers.keys()].sort((a, b) => a - b)) { const ids = layers.get(l)!; const tw = ids.length * (NODE_W + X_GAP) - X_GAP; ids.forEach((id, i) => result.push({ id, x: i * (NODE_W + X_GAP) - tw / 2 + 160, y: l * Y_GAP + 20 })); }
    return result;
  }, [activeGraph]);
  const layoutMap = useMemo(() => { const m = new Map<string, { x: number; y: number }>(); for (const n of layout) m.set(n.id, { x: n.x, y: n.y }); return m; }, [layout]);

  const handleWheel = useCallback((e: React.WheelEvent) => { e.preventDefault(); setTransform(t => ({ ...t, scale: Math.max(0.3, Math.min(3, t.scale + (e.deltaY > 0 ? -0.1 : 0.1))) })); }, []);
  const handleMouseDown = useCallback((e: React.MouseEvent) => { if ((e.target as Element)?.tagName === 'svg') { setDragging(true); dragStart.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y }; } }, [transform]);
  const handleMouseMove = useCallback((e: React.MouseEvent) => { if (!dragging) return; setTransform(t => ({ ...t, x: dragStart.current.tx + (e.clientX - dragStart.current.x), y: dragStart.current.ty + (e.clientY - dragStart.current.y) })); }, [dragging]);
  const handleMouseUp = useCallback(() => setDragging(false), []);

  const selectedNodeData = useMemo(() => graph?.nodes.find(n => n.id === selectedNode) || null, [graph, selectedNode]);

  const downstream = useMemo(() => {
    if (!activeGraph || !selectedNode) return [];
    const result: Array<{ node: any; edge?: any; depth: number }> = [];
    const visited = new Set<string>(); const q: Array<{ id: string; depth: number; edge?: any }> = [{ id: selectedNode, depth: 0 }];
    while (q.length > 0) { const { id, depth, edge } = q.shift()!; if (visited.has(id)) continue; visited.add(id); const n = activeGraph.nodes.find(nd => nd.id === id); if (!n) continue; result.push({ node: n, edge, depth }); for (const e of activeGraph.edges) { if (e.from === id && !visited.has(e.to)) q.push({ id: e.to, depth: depth + 1, edge: e }); } }
    return result;
  }, [activeGraph, selectedNode]);

  if (!graph || graph.nodes.length === 0) {
    return <div className="flex items-center justify-center h-full" style={{ background: '#0d1117' }}><p className="text-sm" style={{ color: '#484f58' }}>{phase === 'idle' ? '等待 Mapper 分析...' : '暂无数据'}</p></div>;
  }

  const renderTree = (node: TreeNode) => {
    const isCollapsed = collapsed.has(node.id);
    const c = STATUS_COLORS[node.status] || STATUS_COLORS.existing;
    const isSel = selectedNode === node.id;
    return (
      <div key={node.id} style={{ marginLeft: node.depth * 12 }}>
        <div onClick={() => onSelectNode(isSel ? null : node.id)}
          className="flex items-center gap-1.5 py-1 px-1.5 rounded cursor-pointer transition-colors hover:bg-white/5"
          style={{ background: isSel ? c + '15' : 'transparent' }}>
          {node.children.length > 0 ? (
            <button onClick={(e) => { e.stopPropagation(); setCollapsed(prev => { const s = new Set(prev); s.has(node.id) ? s.delete(node.id) : s.add(node.id); return s; }); }}
              className="text-[8px] w-3 shrink-0" style={{ color: '#8b949e' }}>{isCollapsed ? '▸' : '▾'}</button>
          ) : <span className="w-3 shrink-0" />}
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c }} />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] truncate" style={{ color: isSel ? '#e6e6e6' : '#c9d1d9' }}>{node.label}</div>
            {node.detail && <div className="text-[9px] truncate" style={{ color: '#6e7681' }}>{node.detail.slice(0, 40)}</div>}
          </div>
        </div>
        {!isCollapsed && node.children.map(child => renderTree(child))}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#0d1117' }}>
      {/* Top: detail bar (shown when node selected) */}
      {selectedNodeData && (
        <div className="flex items-center gap-4 px-4 py-2 border-b shrink-0" style={{ borderColor: '#21262d', background: (STATUS_COLORS[selectedNodeData.status] || '#888') + '08' }}>
          <button onClick={() => onSelectNode(null)} className="text-[10px] hover:opacity-80" style={{ color: '#8b949e' }}>✕</button>
          <span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLORS[selectedNodeData.status] || '#888' }} />
          <span className="text-[12px] font-semibold" style={{ color: '#e6e6e6' }}>{selectedNodeData.label}</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: (STATUS_COLORS[selectedNodeData.status] || '#888') + '20', color: STATUS_COLORS[selectedNodeData.status] || '#888' }}>{STATUS_NAMES[selectedNodeData.status] || selectedNodeData.status}</span>
          {selectedNodeData.file && <span className="text-[10px] font-mono" style={{ color: '#58a6ff' }}>{selectedNodeData.file}{selectedNodeData.line ? `:${selectedNodeData.line}` : ''}</span>}
          <span className="text-[11px] truncate flex-1" style={{ color: '#8b949e' }}>{selectedNodeData.detail?.slice(0, 100) || ''}</span>
          {downstream.length > 1 && (
            <span className="text-[10px] shrink-0" style={{ color: '#484f58' }}>下游 {downstream.length - 1} 个节点</span>
          )}
        </div>
      )}

      {/* Body: Tree + Graph */}
      <div className="flex-1 flex overflow-hidden">
        {/* Tree panel */}
        <div className="shrink-0 border-r overflow-y-auto p-2 relative" style={{ width: treeWidth, borderColor: '#21262d' }}>
          {/* Resize handle */}
          <div
            onMouseDown={handleResizeStart}
            className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-white/10 transition-colors z-10"
            style={{ background: resizing ? 'rgba(255,255,255,0.15)' : undefined }}
          />
          {roots.map(rootId => {
            const rn = graph.nodes.find(n => n.id === rootId);
            if (!rn) return null;
            const c = STATUS_COLORS[rn.status] || STATUS_COLORS.existing;
            const isActive = activeRoot === rootId;
            return (
              <div key={rootId}>
                <div onClick={() => setActiveRoot(isActive ? null : rootId)}
                  className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors hover:bg-white/5 mb-1"
                  style={{ background: isActive ? c + '15' : 'transparent' }}>
                  <span className="text-[8px]" style={{ color: '#8b949e' }}>{isActive ? '▾' : '▸'}</span>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />
                  <span className="text-[11px] font-medium truncate flex-1" style={{ color: '#e6e6e6' }}>{rn.label.slice(0, 18)}</span>
                </div>
                {isActive && tree && renderTree(tree)}
              </div>
            );
          })}
          {!activeRoot && <p className="text-[10px] text-center py-4" style={{ color: '#484f58' }}>点击入口展开调用树</p>}
        </div>

        {/* Graph */}
        <div className="flex-1 overflow-hidden" style={{ cursor: dragging ? 'grabbing' : 'grab' }}
          onWheel={handleWheel} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
          {activeRoot && activeGraph && layout.length > 0 ? (
            <svg width="100%" height="100%">
              <defs><marker id="arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="#4a5568" /></marker></defs>
              <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`}>
                {activeGraph.edges.map((e, i) => {
                  const from = layoutMap.get(e.from), to = layoutMap.get(e.to);
                  if (!from || !to) return null;
                  const ec = { existing: '#3a5a8c', new: '#22c55e', removed: '#ff4444', error: '#ff4444' }[e.status] || '#3a5a8c';
                  const siblings = activeGraph.edges.filter(se => se.from === e.from);
                  const idx = siblings.indexOf(e);
                  const off = siblings.length > 1 ? (idx - (siblings.length - 1) / 2) * 14 : 0;
                  return (
                    <g key={`e${i}`}>
                      <path d={`M${from.x + NODE_W / 2},${from.y + NODE_H} L${from.x + NODE_W / 2},${(from.y + NODE_H + to.y) / 2} L${to.x + NODE_W / 2},${(from.y + NODE_H + to.y) / 2} L${to.x + NODE_W / 2},${to.y}`}
                        fill="none" stroke={ec} strokeWidth={1.5} markerEnd="url(#arrow)" />
                      {e.label && <text x={from.x + NODE_W / 2 + 6} y={(from.y + NODE_H + to.y) / 2 - 4 + off} fill="#8b949e" fontSize="9" fontFamily="monospace">{e.label}</text>}
                    </g>
                  );
                })}
                {layout.map(n => {
                  const node = activeGraph.nodes.find(nd => nd.id === n.id);
                  if (!node) return null;
                  const c = STATUS_COLORS[node.status] || STATUS_COLORS.existing;
                  const isSel = selectedNode === node.id;
                  return (
                    <g key={n.id} style={{ cursor: 'pointer' }} onClick={() => onSelectNode(isSel ? null : node.id)}>
                      <rect x={n.x} y={n.y} width={NODE_W} height={NODE_H} rx={6} fill={isSel ? '#161b22' : '#0d1117'} stroke={isSel ? c : '#21262d'} strokeWidth={isSel ? 2 : 1} />
                      <rect x={n.x} y={n.y + 4} width={3} height={NODE_H - 8} rx={1.5} fill={c} opacity={0.8} />
                      <text x={n.x + 14} y={n.y + 16} fill="#e6e6e6" fontSize="11" fontWeight={600}>{node.label.slice(0, 26)}</text>
                      {node.file && <text x={n.x + 14} y={n.y + 30} fill="#58a6ff" fontSize="9" fontFamily="monospace">{(node.file.length > 28 ? '…' : '') + node.file.slice(-28)}</text>}
                      <text x={n.x + 14} y={n.y + 46} fill="#6e7681" fontSize="9">{node.detail?.slice(0, 36) || ''}</text>
                    </g>
                  );
                })}
              </g>
            </svg>
          ) : (
            <div className="flex items-center justify-center h-full"><p className="text-sm" style={{ color: '#484f58' }}>选择入口查看调用图</p></div>
          )}
        </div>
      </div>
    </div>
  );
}
