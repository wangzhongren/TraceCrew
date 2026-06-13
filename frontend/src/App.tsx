import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import ChatPanel from './components/ChatPanel';
import MapperView from './components/MapperView';
import type { CallGraph, GraphNode, GraphEdge } from './components/MapCanvas';
import TitleBar from './components/TitleBar';
import SettingsPanel from './components/SettingsPanel';
import RightPanel from './components/RightPanel';
import ResizeHandle from './components/ResizeHandle';
import type { ActionType } from './components/ActionDialog';
import { type StreamState, INITIAL_STREAM_STATE } from './components/ActionPanel';

export interface PipelineState {
  phase: 'idle' | 'planning' | 'executing' | 'reviewing' | 'done' | 'rejected';
  graph: CallGraph | null;
}

export default function App() {
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [pipeline, setPipeline] = useState<PipelineState>({ phase: 'idle', graph: null });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [chatWidth, setChatWidth] = useState(420);
  const [codeWidth, setCodeWidth] = useState(480);

  // Action state (lifted from MapperView)
  const [activeAction, setActiveAction] = useState<ActionType | null>(null);
  const [stream, setStream] = useState<StreamState>(INITIAL_STREAM_STATE);

  const updatePipeline = useCallback((update: Partial<PipelineState>) => {
    setPipeline(prev => ({ ...prev, ...update }));
  }, []);

  const selectedNodeData = useMemo(() => {
    if (!selectedNode || !pipeline.graph) return null;
    return pipeline.graph.nodes.find(n => n.id === selectedNode) || null;
  }, [selectedNode, pipeline.graph]);

  // Keep a ref to the latest graph so SSE handler can access it without stale closure
  const graphRef = useRef(pipeline.graph);
  graphRef.current = pipeline.graph;

  /** Compute downstream nodes for the selected node (used by refactor action) */
  const downstreamNodes = useMemo((): GraphNode[] => {
    if (!pipeline.graph || !selectedNode) return [];
    const visited = new Set<string>();
    const result: GraphNode[] = [];
    const queue = [selectedNode];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const e of pipeline.graph.edges) {
        if (e.from === id && !visited.has(e.to)) {
          queue.push(e.to);
        }
      }
    }
    for (const id of visited) {
      if (id !== selectedNode) {
        const n = pipeline.graph.nodes.find((x) => x.id === id);
        if (n) result.push(n);
      }
    }
    return result;
  }, [pipeline.graph, selectedNode]);

  const handleOpenProject = useCallback((p: string) => {
    setProjectPath(p);
    setPipeline({ phase: 'idle', graph: null });
    setSelectedNode(null);
    setActiveAction(null);
    setStream(INITIAL_STREAM_STATE);
  }, []);

  useEffect(() => {
    try { window.tracecrew?.file.onProjectOpened((p: string) => handleOpenProject(p)); } catch {}
  }, [handleOpenProject]);

  useEffect(() => {
    try {
      window.tracecrew?.file.getProjectPath().then((p: string) => { if (p) setProjectPath(p); });
    } catch {}
  }, []);

  const openFolder = async () => {
    if (typeof window.tracecrew !== 'undefined') {
      try {
        const p = await window.tracecrew.file.openProject();
        if (p) handleOpenProject(p);
      } catch (e) { console.error('openProject failed:', e); }
    } else {
      const demo = prompt('Enter project path:');
      if (demo) handleOpenProject(demo);
    }
  };

  // Action handlers (lifted from MapperView)
  const handleRequestAction = useCallback((action: ActionType) => {
    setActiveAction(action);
  }, []);

  const handleActionClose = useCallback(() => {
    setActiveAction(null);
    setStream(INITIAL_STREAM_STATE);
  }, []);

  const handleGraphChange = useCallback((newGraph: CallGraph) => {
    setPipeline(prev => ({ ...prev, graph: newGraph }));
  }, []);

  const handleActionConfirm = useCallback(async (instruction: string) => {
    if (!projectPath || !selectedNodeData || !activeAction) return;

    setStream({ running: true, phase: 'action', actionOutput: '', reviewOutput: '', tools: [], result: null, reviewRequired: false, error: null });

    try {
      const res = await fetch('/api/v1/agent/action/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: activeAction,
          node: selectedNodeData,
          instruction,
          project_path: projectPath,
          downstream_nodes: activeAction === 'refactor' ? downstreamNodes : [],
        }),
      });

      const reader = res.body?.getReader();
      if (!reader) {
        setStream(prev => ({ ...prev, running: false, reviewRequired: false, error: '无法读取响应流' }));
        return;
      }

      const dec = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() || '';

        for (const part of parts) {
          const lines = part.split('\n');
          let event = '', data = '';
          for (const l of lines) {
            if (l.startsWith('event: ')) event = l.slice(7).trim();
            else if (l.startsWith('data: ')) data = l.slice(6);
          }
          if (!event) continue;

          try {
            const payload = JSON.parse(data);
            setStream(prev => {
              switch (event) {
                case 'phase':
                  return { ...prev, phase: payload.phase || 'action' };
                case 'token':
                  return { ...prev, actionOutput: prev.actionOutput + data };
                case 'reasoning':
                  return prev;
                case 'review_token':
                  return { ...prev, reviewOutput: prev.reviewOutput + data };
                case 'tools':
                  return { ...prev, tools: [...prev.tools, ...(payload.ops || [])] };
                case 'done':
                  if (payload.call_graph && graphRef.current) {
                    const cg = payload.call_graph;
                    if (cg.nodes && Array.isArray(cg.nodes) && cg.nodes.length > 0) {
                      const updatedNodes = cg.nodes as GraphNode[];
                      const updatedEdges = (cg.edges || []) as GraphEdge[];
                      const currentGraph = graphRef.current;

                      const nodeMap = new Map(currentGraph.nodes.map(n => [n.id, n]));
                      for (const un of updatedNodes) {
                        nodeMap.set(un.id, un);
                      }

                      const edgeKey = (e: GraphEdge) => `${e.from}->${e.to}`;
                      const edgeMap = new Map(currentGraph.edges.map(e => [edgeKey(e), e]));
                      for (const ue of updatedEdges) {
                        edgeMap.set(edgeKey(ue), ue);
                      }

                      const newNodes = Array.from(nodeMap.values());
                      const newEdges = Array.from(edgeMap.values());

                      const oldNodes = currentGraph.nodes;
                      const oldEdges = currentGraph.edges;
                      let changed = newNodes.length !== oldNodes.length
                                || newEdges.length !== oldEdges.length;
                      if (!changed) {
                        const oldNodeMap = new Map(oldNodes.map(n => [n.id, n]));
                        for (const nn of newNodes) {
                          const on = oldNodeMap.get(nn.id);
                          if (!on || on.status !== nn.status
                              || on.label !== nn.label
                              || on.detail !== nn.detail
                              || on.kind !== nn.kind
                              || on.file !== nn.file
                              || on.line !== nn.line) {
                            changed = true;
                            break;
                          }
                        }
                      }
                      if (!changed) {
                        const oldEdgeSet = new Set(oldEdges.map(e => edgeKey(e)));
                        for (const ne of newEdges) {
                          if (!oldEdgeSet.has(edgeKey(ne))) {
                            changed = true;
                            break;
                          }
                        }
                      }

                      if (changed) {
                        handleGraphChange({ nodes: newNodes, edges: newEdges });
                      }
                    }
                  }
                  return { ...prev, running: false, result: payload, reviewRequired: payload.review_passed === false };
                default:
                  return prev;
              }
            });
          } catch {
            if (event === 'token') {
              setStream(prev => ({ ...prev, actionOutput: prev.actionOutput + data }));
            } else if (event === 'review_token') {
              setStream(prev => ({ ...prev, reviewOutput: prev.reviewOutput + data }));
            }
          }
        }
      }
    } catch (e: any) {
      setStream(prev => ({ ...prev, running: false, reviewRequired: false, error: e.message || '网络错误' }));
    }
  }, [activeAction, selectedNodeData, projectPath, downstreamNodes, handleGraphChange]);

  // Show right panel if there's a file OR an active action with a node
  const showRightPanel = !!(selectedNodeData?.file || (activeAction && selectedNodeData));

  return (
    <div className="w-screen h-screen flex flex-col" style={{ background: 'var(--ibm-bg)' }}>
      <TitleBar projectName={projectPath?.split(/[\\/]/).pop() || ''} />

      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 h-7 shrink-0 border-b"
        style={{ borderColor: 'var(--ibm-border-subtle)', background: 'var(--ibm-layer)' }}>
        <div className="flex items-center gap-2">
          {projectPath ? (
            <span className="text-[11px]" style={{ color: 'var(--ibm-text-placeholder)' }}>{projectPath}</span>
          ) : (
            <span className="text-[11px]" style={{ color: 'var(--ibm-text-disabled)' }}>No project selected</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={openFolder}
            className="text-[11px] px-2 py-0.5 rounded transition-colors hover:bg-black/[0.03]"
            style={{ color: 'var(--ibm-primary)' }}>
            {projectPath ? 'Switch Project' : 'Open Folder'}
          </button>
          <SettingsBtn />
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {projectPath ? (
          <>
            {/* Left: Chat Panel */}
            <aside className="shrink-0 border-r overflow-hidden"
              style={{ width: chatWidth, background: 'var(--ibm-layer)', borderColor: 'var(--ibm-border-subtle)' }}>
              <ChatPanel key={projectPath} projectPath={projectPath} onPipelineChange={updatePipeline} />
            </aside>
            <ResizeHandle direction="vertical" onResize={(d) => setChatWidth(w => Math.max(280, Math.min(600, w + d)))} />
            {/* Center: Call Graph */}
            <main className="flex-1 flex overflow-hidden" style={{ background: 'var(--ibm-bg)' }}>
              <div className="flex-1 overflow-hidden" style={{ minWidth: 0 }}>
                <MapperView
                  key={projectPath}
                  graph={pipeline.graph}
                  phase={pipeline.phase}
                  selectedNode={selectedNode}
                  onSelectNode={setSelectedNode}
                  onGraphChange={handleGraphChange}
                  projectPath={projectPath}
                  activeAction={activeAction}
                  onRequestAction={handleRequestAction}
                  streamRunning={stream.running}
                />
              </div>
              {/* Right: Code Viewer + Action Panel */}
              {showRightPanel && (
                <>
                  <ResizeHandle direction="vertical" onResize={(d) => setCodeWidth(w => Math.max(300, Math.min(900, w - d)))} />
                  <div className="shrink-0 border-l overflow-hidden flex flex-col min-h-0"
                    style={{ width: codeWidth, minWidth: 300, borderColor: 'var(--ibm-border-subtle)' }}>
                    <RightPanel
                      filePath={selectedNodeData?.file ?? null}
                      projectPath={projectPath}
                      scrollToLine={selectedNodeData?.line ?? null}
                      activeAction={activeAction}
                      actionNode={selectedNodeData}
                      downstreamNodes={downstreamNodes}
                      stream={stream}
                      onActionConfirm={handleActionConfirm}
                      onActionClose={handleActionClose}
                    />
                  </div>
                </>
              )}
            </main>
          </>
        ) : (
          <main className="flex-1 flex items-center justify-center" style={{ background: 'var(--ibm-bg)' }}>
            <div className="text-center space-y-4">
              <svg width="48" height="48" viewBox="0 0 32 32" fill="none" stroke="var(--ibm-text-disabled)" strokeWidth="1" style={{ margin: '0 auto' }}>
                <path d="M4 6h10l4 4h10v16H4z"/>
              </svg>
              <p className="text-sm" style={{ color: 'var(--ibm-text-placeholder)' }}>Open a project folder to get started</p>
              <button onClick={openFolder}
                className="px-5 py-2 text-xs font-medium rounded transition-colors"
                style={{ background: 'var(--ibm-primary)', color: '#fff' }}>
                Open Folder
              </button>
            </div>
          </main>
        )}
      </div>
    </div>
  );
}

function SettingsBtn() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} title="Settings"
        className="w-7 h-7 flex items-center justify-center rounded transition-colors hover:bg-black/[0.03]"
        style={{ color: 'var(--ibm-text-placeholder)' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
        </svg>
      </button>
      {open && <SettingsPanel onClose={() => setOpen(false)} />}
    </div>
  );
}
