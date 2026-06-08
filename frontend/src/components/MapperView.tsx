import { useState, useMemo, useEffect, useRef } from 'react';
import MapCanvas from './MapCanvas';
import type { CallGraph } from './MapCanvas';

interface Props {
  graph: CallGraph | null;
  phase: 'idle' | 'planning' | 'executing' | 'reviewing' | 'done' | 'rejected';
  onSelectNode: (id: string | null) => void;
  selectedNode: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  existing: '#4a9eff', problem: '#ff4444', planned_change: '#f0c000', planned_new: '#22c55e', done: '#22c55e',
};
const STATUS_ICONS: Record<string, string> = {
  existing: '◈', problem: '✕', planned_change: '✎', planned_new: '+', done: '✓',
};
const STATUS_LABEL: Record<string, string> = {
  existing: '现有', problem: '问题', planned_change: '待改', planned_new: '新增', done: '完成',
};

/** Get sub-graph reachable from given root */
function subGraph(rootId: string, nodes: any[], edges: any[]): CallGraph {
  const visited = new Set<string>();
  const q = [rootId];
  while (q.length > 0) {
    const id = q.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const e of edges) if (e.from === id && !visited.has(e.to)) q.push(e.to);
  }
  return {
    nodes: nodes.filter(n => visited.has(n.id)),
    edges: edges.filter(e => visited.has(e.from) && visited.has(e.to)),
  };
}

interface TreeNode {
  id: string; label: string; detail?: string; status: string; kind?: string; file?: string; line?: number;
  children: TreeNode[];
}

function buildTree(roots: any[], nodes: any[], edges: any[]): TreeNode[] {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const childrenMap = new Map<string, string[]>();
  for (const n of nodes) childrenMap.set(n.id, []);
  for (const e of edges) {
    const arr = childrenMap.get(e.from) || [];
    arr.push(e.to);
    childrenMap.set(e.from, arr);
  }
  function walk(id: string, visited: Set<string>): TreeNode | null {
    if (visited.has(id)) return null;
    visited.add(id);
    const n = nodeMap.get(id);
    if (!n) return null;
    return {
      id: n.id, label: n.label, detail: n.detail, status: n.status,
      kind: n.kind, file: n.file, line: n.line,
      children: (childrenMap.get(id) || [])
        .map(cid => walk(cid, new Set(visited)))
        .filter(Boolean) as TreeNode[],
    };
  }
  return roots.map(r => walk(r.id, new Set())).filter(Boolean) as TreeNode[];
}

/** Card popup with tree structure */
function NodeCardsPopup({ graph, onSelect, onClose, selectedNode: sel }: {
  graph: CallGraph;
  onSelect: (id: string) => void;
  onClose: () => void;
  selectedNode: string | null;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<string>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const h = (e: MouseEvent) => { if (popupRef.current && !popupRef.current.contains(e.target as Node)) onClose(); };
    setTimeout(() => document.addEventListener('mousedown', h), 0);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  // Auto-expand path to selected node
  useEffect(() => {
    if (!sel || graph.nodes.length === 0) return;
    const parents = new Map<string, string>();
    for (const e of graph.edges) parents.set(e.to, e.from);
    const toExpand = new Set<string>();
    let cur: string | undefined = sel;
    while (cur && parents.has(cur)) {
      cur = parents.get(cur);
      if (cur) toExpand.add(cur);
    }
    setCollapsed(prev => { const s = new Set(prev); for (const id of toExpand) s.delete(id); return s; });
  }, [sel, graph]);

  const entryPoints = useMemo(() => {
    const hasIncoming = new Set(graph.edges.map(e => e.to));
    return graph.nodes.filter(n => !hasIncoming.has(n.id));
  }, [graph]);

  const trees = useMemo(() => buildTree(entryPoints, graph.nodes, graph.edges), [graph, entryPoints]);

  const toggleCollapse = (id: string) => {
    setCollapsed(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };

  const hideByFilter = (node: TreeNode): boolean => {
    if (filter === 'all') return false;
    if (node.status === filter) return false;
    return node.children.every(hideByFilter);
  };

  const renderTreeNode = (node: TreeNode, depth: number, isLast: boolean): React.ReactNode => {
    if (hideByFilter(node)) return null;
    const c = STATUS_COLORS[node.status] || STATUS_COLORS.existing;
    const isSel = sel === node.id;
    const isCollapsed = collapsed.has(node.id);
    const hasKids = node.children.length > 0;

    return (
      <div key={node.id}>
        {/* Tree line + card */}
        <div className="flex" style={{ marginLeft: depth * 20 }}>
          {/* Tree connector */}
          {depth > 0 && (
            <div className="flex items-stretch shrink-0" style={{ width: 20 }}>
              <div className="w-2.5 border-b-2 self-center" style={{ borderColor: '#21262d' }} />
              <div className="w-px self-stretch" style={{ background: isLast ? 'transparent' : '#21262d' }} />
            </div>
          )}
          {/* Card */}
          <button
            onClick={() => hasKids ? toggleCollapse(node.id) : onSelect(node.id)}
            onDoubleClick={() => onSelect(node.id)}
            className="flex-1 flex items-start gap-2.5 p-2.5 rounded-lg text-left transition-colors hover:bg-white/5 mb-0.5"
            style={{ background: isSel ? c + '10' : '#0d1117', border: `1px solid ${isSel ? c + '40' : 'transparent'}` }}>
            {/* Status icon + expand */}
            <div className="flex items-center gap-1 shrink-0 mt-0.5">
              {hasKids ? (
                <span className="text-[8px] w-3" style={{ color: '#8b949e' }}>{isCollapsed ? '▸' : '▾'}</span>
              ) : <span className="w-3" />}
              <span className="text-sm">{STATUS_ICONS[node.status]}</span>
            </div>
            {/* Content */}
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium leading-tight mb-0.5" style={{ color: '#c9d1d9' }}>{node.label}</div>
              {node.detail && (
                <div className="text-[9px] leading-snug mb-1" style={{ color: '#6e7681' }}>
                  {node.detail.length > 60 ? node.detail.slice(0, 59) + '…' : node.detail}
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                {node.file && <span className="text-[8px] font-mono truncate max-w-[140px]" style={{ color: '#58a6ff' }}>{node.file.split('/').pop()}</span>}
                {node.kind && <span className="text-[8px] font-mono" style={{ color: '#484f58' }}>{node.kind}</span>}
                {node.status !== 'existing' && (
                  <span className="text-[8px] px-1 py-0.5 rounded" style={{ background: c + '15', color: c }}>
                    {STATUS_LABEL[node.status]}
                  </span>
                )}
              </div>
            </div>
          </button>
        </div>
        {/* Children */}
        {!isCollapsed && hasKids && node.children.map((child, i, arr) =>
          renderTreeNode(child, depth + 1, i === arr.length - 1)
        )}
      </div>
    );
  };

  return (
    <div ref={popupRef} className="absolute top-full left-0 mt-2 z-30 rounded-xl border shadow-2xl"
      style={{ width: 460, maxHeight: 520, background: '#161b22', borderColor: '#30363d', overflow: 'hidden' }}>
      <div className="px-4 py-2.5 border-b flex items-center justify-between" style={{ borderColor: '#21262d' }}>
        <span className="text-[11px] font-medium tracking-wide" style={{ color: '#8b949e' }}>调用链</span>
        <div className="flex items-center gap-1">
          {[
            { key: 'all', label: '全部' },
            { key: 'problem', label: '问题' },
            { key: 'planned_change', label: '待改' },
            { key: 'planned_new', label: '新增' },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => setFilter(key)}
              className="text-[9px] px-2 py-0.5 rounded transition-colors"
              style={{ color: filter === key ? '#e6e6e6' : '#8b949e', background: filter === key ? '#21262d' : 'transparent' }}>
              {label}
            </button>
          ))}
          <button onClick={() => setCollapsed(prev => prev.size === 0 ? new Set(trees.flatMap(t => getAllIds(t))) : new Set())}
            className="text-[9px] px-2 py-0.5 rounded" style={{ color: '#8b949e' }}>
            {collapsed.size > 0 ? '展开' : '折叠'}
          </button>
        </div>
      </div>
      <div className="overflow-y-auto p-3" style={{ maxHeight: 460 }}>
        {trees.map((tree, i) => renderTreeNode(tree, 0, i === trees.length - 1))}
      </div>
    </div>
  );
}

function getAllIds(node: TreeNode): string[] {
  return [node.id, ...node.children.flatMap(getAllIds)];
}

export default function MapperView({ graph, phase, onSelectNode, selectedNode }: Props) {
  const [showCards, setShowCards] = useState(false);
  const [activeRoot, setActiveRoot] = useState<string | null>(null);

  const entryPoints = useMemo(() => {
    if (!graph || graph.nodes.length === 0) return [] as any[];
    const hasIncoming = new Set(graph.edges.map((e: any) => e.to));
    return graph.nodes.filter((n: any) => !hasIncoming.has(n.id));
  }, [graph]);

  // Auto-select first entry
  useEffect(() => {
    if (!graph || graph.nodes.length === 0) return;
    if (entryPoints.length > 0 && !activeRoot) {
      setActiveRoot(entryPoints[0].id);
    }
  }, [graph, entryPoints, activeRoot]);

  const selectedNodeData = useMemo(() => {
    if (!selectedNode || !graph) return null;
    return graph.nodes.find(n => n.id === selectedNode) || null;
  }, [graph, selectedNode]);

  const activeGraph = useMemo(() => {
    if (!graph || !activeRoot) return graph;
    return subGraph(activeRoot, graph.nodes, graph.edges);
  }, [graph, activeRoot]);

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex flex-col h-full" style={{ background: '#0d1117' }}>
        <MapCanvas graph={null} phase={phase} selectedNode={null} onSelectNode={() => {}} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: '#0d1117' }}>
      {/* ════ Top nav ════ */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b" style={{ borderColor: '#21262d' }}>
        {/* Cards dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowCards(!showCards)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-colors hover:bg-white/5 text-[11px]"
            style={{ border: `1px solid ${showCards ? '#30363d' : 'transparent'}`, color: '#c9d1d9' }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="1" y="1" width="4" height="4" rx="1"/><rect x="7" y="1" width="4" height="4" rx="1"/>
              <rect x="1" y="7" width="4" height="4" rx="1"/><rect x="7" y="7" width="4" height="4" rx="1"/>
            </svg>
            <span>节点</span>
            <svg width="7" height="7" viewBox="0 0 8 8"><path d="M2 3 L4 5 L6 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
          {showCards && (
            <NodeCardsPopup
              graph={graph}
              onSelect={(id) => { onSelectNode(id); setShowCards(false); }}
              onClose={() => setShowCards(false)}
              selectedNode={selectedNode}
            />
          )}
        </div>

        {/* Entry tabs */}
        {entryPoints.length > 1 && (
          <div className="flex items-center gap-0.5">
            {entryPoints.map((ep: any) => {
              const c = STATUS_COLORS[ep.status] || STATUS_COLORS.existing;
              const isActive = activeRoot === ep.id;
              return (
                <button key={ep.id}
                  onClick={() => setActiveRoot(ep.id)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors hover:bg-white/5"
                  style={{ color: isActive ? '#e6e6e6' : '#8b949e', background: isActive ? c + '10' : undefined }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: c }}/>
                  <span className="max-w-[100px] truncate">{ep.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Selected node breadcrumb */}
        {selectedNodeData && (
          <div className="flex items-center gap-1 ml-2 text-[10px] overflow-hidden">
            <span style={{ color: '#484f58' }}>选中:</span>
            <span style={{ color: STATUS_COLORS[selectedNodeData.status] || '#888' }}>
              {STATUS_ICONS[selectedNodeData.status]}
            </span>
            <span style={{ color: '#c9d1d9' }} className="truncate max-w-[200px]">
              {selectedNodeData.label}
            </span>
            <button onClick={() => onSelectNode(null)} className="text-[10px] hover:opacity-80 shrink-0" style={{ color: '#484f58' }}>✕</button>
          </div>
        )}

        <div className="ml-auto text-[10px] shrink-0" style={{ color: '#484f58' }}>
          {graph.nodes.length} 节点 · {graph.edges.length} 边
        </div>
      </div>

      {/* ════ Bottom: MapCanvas — one sub-graph per entry ════ */}
      <div className="flex-1 overflow-hidden">
        <MapCanvas
          graph={activeGraph}
          phase={phase}
          selectedNode={selectedNode}
          onSelectNode={onSelectNode}
        />
      </div>
    </div>
  );
}
