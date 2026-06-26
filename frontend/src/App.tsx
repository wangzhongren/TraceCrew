import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useT, useLocale, LOCALE_LABELS, type Locale } from './i18n';
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
  phase: 'idle' | 'planning' | 'reviewing' | 'done' | 'rejected';
  graph: CallGraph | null;
  savedPlan?: { plan_summary: string; steps: any[]; key_files: string[]; raw: string } | null;
}

export default function App() {
  const t = useT();
  const { locale } = useLocale();
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [pipeline, setPipeline] = useState<PipelineState>({ phase: 'idle', graph: null });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [chatWidth, setChatWidth] = useState(420);
  const [codeWidth, setCodeWidth] = useState(480);

  // Action state (lifted from MapperView)
  const [activeAction, setActiveAction] = useState<ActionType | null>(null);
  const [stream, setStream] = useState<StreamState>(INITIAL_STREAM_STATE);

  // Auto-exec state
  const [autoExecRunning, setAutoExecRunning] = useState(false);
  const [autoExecProgress, setAutoExecProgress] = useState<{ current: number; total: number; currentNodeId: string | null } | null>(null);
  const autoExecStopRef = useRef(false);

  // Per-node execution records (for card expand)
  const [execRecords, setExecRecords] = useState<Record<string, {
    summary: string; review_passed: boolean | null;
    review_feedback?: string; review_issues?: any[];
  }>>({});

  // Live output for currently executing node
  const [liveOutput, setLiveOutput] = useState<Record<string, string>>({});

  // Auto-save execution record when stream completes
  useEffect(() => {
    if (!stream.result || !selectedNode) return;
    if (stream.result.message) {
      setExecRecords(prev => ({
        ...prev,
        [selectedNode]: {
          summary: stream.result!.message || '',
          review_passed: stream.result!.review_passed ?? null,
          review_feedback: stream.result!.review_feedback,
          review_issues: stream.result!.review_issues,
        },
      }));
    }
  }, [stream.result, selectedNode]);

  // Per-node stream persistence: save/restore action state when switching nodes
  const savedStreamsRef = useRef<Record<string, StreamState>>({});
  const streamRef = useRef(stream);
  streamRef.current = stream;

  // AbortController for SSE fetch in handleActionConfirm
  const actionAbortRef = useRef<AbortController | null>(null);

  // Saved plan ref for use in handleActionConfirm (avoids stale closure)
  const savedPlanRef = useRef(pipeline.savedPlan);
  savedPlanRef.current = pipeline.savedPlan;

  // Sync current node's stream to saved storage on every change
  useEffect(() => {
    if (selectedNode) {
      savedStreamsRef.current[selectedNode] = streamRef.current;
    }
  }, [stream, selectedNode]);

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

  // Persist graph state to disk (on every change — small JSON, fast write)
  useEffect(() => {
    if (!pipeline.graph?.nodes?.length || !projectPath) return;
    window.tracecrew.file.writeFile('.tracecrew/STATE.json', JSON.stringify({
      graph: pipeline.graph,
      savedPlan: pipeline.savedPlan,
      updatedAt: new Date().toISOString(),
    }, null, 2)).catch(() => {});
  }, [pipeline.graph, pipeline.savedPlan, projectPath]);

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
    setSelectedNode(null);
    setActiveAction(null);
    setStream(INITIAL_STREAM_STATE);

    // Try to restore saved state
    (async () => {
      try {
        const fc = await window.tracecrew.file.readFile(p + '/.tracecrew/STATE.json');
        if (fc?.content) {
          const state = JSON.parse(fc.content);
          if (state.graph?.nodes?.length > 0) {
            setPipeline({ phase: 'done', graph: state.graph, savedPlan: state.savedPlan });
            return;
          }
        }
      } catch { /* no saved state */ }
      setPipeline({ phase: 'idle', graph: null });
    })();
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
      const demo = prompt(t('app.enterProjectPath'));
      if (demo) handleOpenProject(demo);
    }
  };

  // Action handlers (lifted from MapperView)
  const handleRequestAction = useCallback((action: ActionType) => {
    setActiveAction(action);
    setStream(INITIAL_STREAM_STATE);
  }, []);

  const handleSelectNode = useCallback((id: string | null) => {
    setSelectedNode(prevId => {
      // Save current node's stream before switching away
      if (prevId && activeAction) {
        savedStreamsRef.current[prevId] = streamRef.current;
      }
      // Restore target node's saved stream, or start fresh
      if (id && savedStreamsRef.current[id]) {
        setStream(savedStreamsRef.current[id]);
      } else if (activeAction) {
        setStream(INITIAL_STREAM_STATE);
      }
      return id;
    });
  }, [activeAction]);

  const handleActionClose = useCallback(() => {
    // Abort any in-flight SSE request
    if (actionAbortRef.current) {
      actionAbortRef.current.abort();
      actionAbortRef.current = null;
    }
    // Clear saved stream for this node when closing the action
    if (selectedNode) {
      delete savedStreamsRef.current[selectedNode];
    }
    setActiveAction(null);
    setStream(INITIAL_STREAM_STATE);
  }, [selectedNode]);

  const handleGraphChange = useCallback((newGraph: CallGraph) => {
    setPipeline(prev => ({ ...prev, graph: newGraph }));
  }, []);

  const handleReplan = useCallback(() => {
    handleActionClose();
    setPipeline(prev => ({ ...prev, phase: 'idle' }));
  }, [handleActionClose]);

  // Topological sort nodes by dependency edges.
  // Only edges whose BOTH endpoints are in `nodes` count as dependencies.
  const topoSortNodes = useCallback((nodes: GraphNode[], edges: { from: string; to: string }[]): GraphNode[] => {
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const n of nodes) { inDegree.set(n.id, 0); adj.set(n.id, []); }
    for (const e of edges) {
      // Ignore edges where either endpoint is outside the current node set
      if (!inDegree.has(e.from) || !inDegree.has(e.to)) continue;
      inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
      adj.get(e.from)!.push(e.to);
    }
    const queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
    const result: GraphNode[] = [];
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    while (queue.length > 0) {
      const id = queue.shift()!;
      const n = nodeMap.get(id); if (n) result.push(n);
      for (const to of (adj.get(id) || [])) {
        const d = (inDegree.get(to) || 1) - 1;
        inDegree.set(to, d);
        if (d === 0) queue.push(to);
      }
    }
    return result;
  }, []);

  // SSE helper: run a single action and return full result
  const runSingleAction = useCallback(async (
    node: GraphNode, action: ActionType, projectPath: string,
    onEvent?: (ev: { type: string; data: string }) => void,
  ): Promise<{ passed: boolean | null; feedback?: string; issues?: any[]; message?: string }> => {
    try {
      const res = await fetch('/api/v1/agent/action/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          node,
          instruction: '',
          project_path: projectPath,
          downstream_nodes: action === 'refactor' ? [] : [],
          locale,
          plan_context: savedPlanRef.current || null,
        }),
      });

      const reader = res.body?.getReader();
      if (!reader) return { passed: null };
      const dec = new TextDecoder();
      let buf = '';
      let result: any = null;

      let chunkCount = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        chunkCount++;
        if (chunkCount <= 3) console.log('[runSingleAction chunk]', chunk.slice(0, 300));
        buf += chunk;
        const parts = buf.split('\n');
        buf = parts.pop() || '';
        for (const line of parts) {
          if (!line.trim()) continue;
          let event2: string, data2: any;
          try { const p = JSON.parse(line); event2 = p.event; data2 = p.data; } catch (e: any) { console.error('[runSingleAction JSON.parse]', line.slice(0, 200), e.message); continue; }
          if (!event2) continue;
          const d = typeof data2 === 'string' ? (() => { try { return JSON.parse(data2); } catch { return data2; } })() : data2;
          if (event2 === 'token' || event2 === 'review_token') {
            onEvent?.({ type: 'token', data: d });
          } else if (event2 === 'phase') {
            try { onEvent?.({ type: 'phase', data: d.phase }); } catch {}
          } else if (event2 === 'tools') {
            try { onEvent?.({ type: 'tools', data: `${d.ops?.length || 0} 个工具操作` }); } catch {}
          } else if (event2 === 'done') {
            console.log('[runSingleAction done]', JSON.stringify(d).slice(0, 500));
            result = d;
          }
        }
      }
      const ret = {
        passed: result?.review_passed ?? null,
        feedback: result?.review_feedback,
        issues: result?.review_issues,
        message: result?.message,
      };
      console.log('[runSingleAction return]', JSON.stringify(ret).slice(0, 300));
      return ret;
    } catch (e: any) {
      console.error('[runSingleAction ERROR]', e.message || e, e.stack?.slice(0, 300));
      return { passed: null };
    }
  }, [locale]);

  const handleExecuteNode = useCallback(async (nodeId: string, action: ActionType) => {
    const graph = graphRef.current;
    const node = graph?.nodes.find(n => n.id === nodeId);
    if (!node || !projectPath) return;

    setAutoExecProgress({ current: 0, total: 1, currentNodeId: nodeId });
    setLiveOutput(prev => ({ ...prev, [nodeId]: '' }));

    const result = await runSingleAction(node, action, projectPath, (ev) => {
      if (ev.type === 'token') {
        setLiveOutput(prev => ({ ...prev, [nodeId]: (prev[nodeId] || '') + ev.data }));
      } else if (ev.type === 'phase') {
        setLiveOutput(prev => ({ ...prev, [nodeId]: (prev[nodeId] || '') + `\n\n[${ev.data}]\n` }));
      } else if (ev.type === 'tools') {
        setLiveOutput(prev => ({ ...prev, [nodeId]: (prev[nodeId] || '') + `\n🔧 ${ev.data}\n` }));
      }
    });

    setExecRecords(prev => ({
      ...prev,
      [nodeId]: {
        summary: result.message || '',
        review_passed: result.passed,
        review_feedback: result.feedback,
        review_issues: result.issues,
      },
    }));

    if (result.passed !== false) {
      const g = graphRef.current;
      if (g) {
        const updatedNodes = g.nodes.map(n =>
          n.id === nodeId ? { ...n, status: 'done' as const } : n
        );
        graphRef.current = { nodes: updatedNodes, edges: g.edges };
        setPipeline(prev => ({ ...prev, graph: { nodes: updatedNodes, edges: g.edges } }));
      }
    }

    setAutoExecProgress(null);
  }, [projectPath, runSingleAction]);

  // Auto-execute all pending tasks in dependency order
  const handleAutoExec = useCallback(async () => {
    try {
      const graph = graphRef.current;
      if (!graph || !projectPath) return;

      const pending = graph.nodes.filter(n =>
        n.status !== 'done' && n.status !== 'existing'
      );
      if (pending.length === 0) {
        alert('所有任务已完成，没有待执行的任务。');
        return;
      }

      // Reset any stale stream state so the button isn't disabled
      setStream(INITIAL_STREAM_STATE);
      // Abort any lingering SSE request from right panel
      if (actionAbortRef.current) {
        actionAbortRef.current.abort();
        actionAbortRef.current = null;
      }

      const sorted = topoSortNodes(pending, graph.edges);
      const total = sorted.length;
      autoExecStopRef.current = false;
      setAutoExecRunning(true);
      setAutoExecProgress({ current: 0, total, currentNodeId: null });

      let completed = 0;
      let skipped = 0;
      for (const node of sorted) {
      if (autoExecStopRef.current) break;

      // Check deps
      const incoming = graph.edges.filter(e => e.to === node.id);
      const unmetDeps = incoming.filter(e => {
        const depGraph = graphRef.current?.nodes.find(n => n.id === e.from);
        return depGraph && depGraph.status !== 'done' && depGraph.status !== 'existing';
      });
      if (unmetDeps.length > 0) {
        skipped++;
        continue; // skip, dependencies not met
      }

      setAutoExecProgress({ current: completed, total, currentNodeId: node.id });

      // Run the action with live output
      setLiveOutput(prev => ({ ...prev, [node.id]: '' }));
      const result = await runSingleAction(node, 'develop', projectPath, (ev) => {
        if (ev.type === 'token') {
          setLiveOutput(prev => ({ ...prev, [node.id]: (prev[node.id] || '') + ev.data }));
        } else if (ev.type === 'phase') {
          setLiveOutput(prev => ({ ...prev, [node.id]: (prev[node.id] || '') + `\n\n[${ev.data}]\n` }));
        } else if (ev.type === 'tools') {
          setLiveOutput(prev => ({ ...prev, [node.id]: (prev[node.id] || '') + `\n🔧 ${ev.data}\n` }));
        }
      });

      console.log(`[autoExec result] node=${node.label} passed=${result.passed} feedback=`, (result.feedback || '').slice(0, 80));
      // Save exec record
      setExecRecords(prev => ({
        ...prev,
        [node.id]: {
          summary: result.message || '',
          review_passed: result.passed,
          review_feedback: result.feedback,
          review_issues: result.issues,
        },
      }));

      if (!autoExecStopRef.current && result.passed !== false) {
        // Update node status — sync ref immediately so next iteration sees it
        const g = graphRef.current;
        if (g) {
          const updatedNodes = g.nodes.map(n =>
            n.id === node.id ? { ...n, status: 'done' as const, detail: (n.detail || '') + '\n✅ 已完成' } : n
          );
          const newGraph = { nodes: updatedNodes, edges: g.edges };
          graphRef.current = newGraph; // sync immediately for next loop iteration
          setPipeline(prev => ({ ...prev, graph: newGraph }));
        }
      }
      completed++;
    }

      // Warn if all nodes were skipped due to unmet dependencies
      if (!autoExecStopRef.current && completed === 0 && skipped > 0) {
        alert(`无法执行任何任务：${skipped} 个任务的前置依赖尚未完成。请先执行上游节点。`);
      }
    } catch (e) {
      console.error('[autoExec] error:', e);
    }
    setAutoExecRunning(false);
    setAutoExecProgress(null);
  }, [projectPath, topoSortNodes, runSingleAction]);

  const handleStopAutoExec = useCallback(() => {
    autoExecStopRef.current = true;
    setAutoExecRunning(false);
    setAutoExecProgress(null);
  }, []);

  const handleActionConfirm = useCallback(async (instruction: string) => {
    if (!projectPath || !selectedNodeData || !activeAction) return;

    // Abort any previous in-flight request
    if (actionAbortRef.current) {
      actionAbortRef.current.abort();
    }
    const controller = new AbortController();
    actionAbortRef.current = controller;

    setStream({ running: true, phase: 'action', timeline: [{ phase: 'action', output: '', tools: [] }], result: null, error: null });

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
          locale,
          plan_context: savedPlanRef.current || null,
        }),
        signal: controller.signal,
      });

      const reader = res.body?.getReader();
      if (!reader) {
        setStream(prev => ({ ...prev, running: false, error: t('app.cannotReadStream') }));
        return;
      }

      const dec = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n');
        buf = parts.pop() || '';

        for (const line of parts) {
          if (!line.trim()) continue;
          const { event, data } = JSON.parse(line);
          if (!event) continue;

          const d = typeof data === 'string' ? (() => { try { return JSON.parse(data); } catch { return data; } })() : data;
          try {
            setStream(prev => {
              switch (event) {
                case 'phase': {
                  const newPhase = d.phase || 'action';
                  return {
                    ...prev,
                    phase: newPhase,
                    timeline: [...prev.timeline, { phase: newPhase, output: '', tools: [] }],
                  };
                }
                case 'token':
                case 'review_token':
                case 'remap_token': {
                  // Append token to the last timeline entry
                  const tl = [...prev.timeline];
                  if (tl.length > 0) {
                    const last = { ...tl[tl.length - 1] };
                    last.output += d;
                    tl[tl.length - 1] = last;
                  }
                  return { ...prev, timeline: tl };
                }
                case 'reasoning':
                  return prev;
                case 'tools': {
                  // Add tools to the last timeline entry
                  const tl = [...prev.timeline];
                  if (tl.length > 0) {
                    const last = { ...tl[tl.length - 1] };
                    last.tools = [...last.tools, ...(d.ops || [])];
                    tl[tl.length - 1] = last;
                  }
                  return { ...prev, timeline: tl };
                }
                case 'done':
                  // Update single target node if review passed
                  if (d.updated_node && graphRef.current) {
                    const un = d.updated_node;
                    const currentGraph = graphRef.current;
                    const nodeIdx = currentGraph.nodes.findIndex(n => n.id === un.id);
                    if (nodeIdx !== -1) {
                      const updatedNodes = [...currentGraph.nodes];
                      updatedNodes[nodeIdx] = {
                        ...updatedNodes[nodeIdx],
                        status: un.status || updatedNodes[nodeIdx].status,
                        detail: un.detail || updatedNodes[nodeIdx].detail,
                      };
                      handleGraphChange({ nodes: updatedNodes, edges: currentGraph.edges });
                    }
                  }
                  return { ...prev, running: false, result: d };
                default:
                  return prev;
              }
            });
          } catch {
            // Non-JSON data — append as token to last timeline entry
            if (event === 'token' || event === 'review_token' || event === 'remap_token') {
              setStream(prev => {
                const tl = [...prev.timeline];
                if (tl.length > 0) {
                  const last = { ...tl[tl.length - 1] };
                  last.output += data;
                  tl[tl.length - 1] = last;
                }
                return { ...prev, timeline: tl };
              });
            }
          }
        }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setStream(INITIAL_STREAM_STATE);
      } else {
        setStream(prev => ({ ...prev, running: false, error: e.message || t('app.networkError') }));
      }
    } finally {
      actionAbortRef.current = null;
    }
  }, [activeAction, selectedNodeData, projectPath, downstreamNodes, handleGraphChange, t]);

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
            <span className="text-[11px]" style={{ color: 'var(--ibm-text-disabled)' }}>{t('app.noProject')}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={openFolder}
            className="text-[11px] px-2 py-0.5 rounded transition-colors hover:bg-black/[0.03]"
            style={{ color: 'var(--ibm-primary)' }}>
            {projectPath ? t('app.switchProject') : t('app.openFolder')}
          </button>
          <LocaleSwitcher />
          <SettingsBtn />
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {projectPath ? (
          <>
            {/* Left: Chat Panel */}
            <aside className="shrink-0 border-r overflow-hidden"
              style={{ width: chatWidth, background: 'var(--ibm-layer)', borderColor: 'var(--ibm-border-subtle)' }}>
              <ChatPanel key={projectPath} projectPath={projectPath} onPipelineChange={updatePipeline}
                savedPlan={pipeline.savedPlan} savedGraph={pipeline.graph} />
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
                  onSelectNode={handleSelectNode}
                  onGraphChange={handleGraphChange}
                  projectPath={projectPath}
                  activeAction={activeAction}
                  onRequestAction={handleRequestAction}
                  streamRunning={stream.running}
                  onAutoExec={handleAutoExec}
                  onStopAutoExec={handleStopAutoExec}
                  autoExecRunning={autoExecRunning}
                  autoExecProgress={autoExecProgress}
                  execRecords={execRecords}
                  liveOutput={liveOutput}
                  onExecuteNode={handleExecuteNode}
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
                      onReplan={handleReplan}
                      onCloseCode={() => setSelectedNode(null)}
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
              <p className="text-sm" style={{ color: 'var(--ibm-text-placeholder)' }}>{t('app.getStarted')}</p>
              <button onClick={openFolder}
                className="px-5 py-2 text-xs font-medium rounded transition-colors"
                style={{ background: 'var(--ibm-primary)', color: '#fff' }}>
                {t('app.openFolder')}
              </button>
            </div>
          </main>
        )}
      </div>
    </div>
  );
}

function SettingsBtn() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} title={t('app.settings')}
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

function LocaleSwitcher() {
  const { locale, setLocale } = useLocale();
  return (
    <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}
      className="text-[11px] px-1.5 py-0.5 rounded border bg-transparent outline-none cursor-pointer"
      style={{ borderColor: 'var(--ibm-border-subtle)', color: 'var(--ibm-text-secondary)' }}>
      {(Object.keys(LOCALE_LABELS) as Locale[]).map(l => (
        <option key={l} value={l}>{LOCALE_LABELS[l]}</option>
      ))}
    </select>
  );
}
