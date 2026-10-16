import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useT, useLocale, LOCALE_LABELS, type Locale } from './i18n';
import ChatPanel from './components/ChatPanel';
import MapperView from './components/MapperView';
import type { CallGraph, GraphNode } from './types/graph';
import TitleBar from './components/TitleBar';
import SettingsPanel from './components/SettingsPanel';
import RightPanel from './components/RightPanel';
import ResizeHandle from './components/ResizeHandle';
import { cleanProtocolTags, type ActionType } from './components/ActionDialog';
import { type StreamState, INITIAL_STREAM_STATE } from './components/ActionPanel';

export interface PipelineState {
  phase: 'idle' | 'clarifying' | 'planning' | 'reviewing' | 'done' | 'rejected';
  graph: CallGraph | null;
  sequenceGraph: CallGraph | null;
  savedPlan?: { plan_summary: string; steps: any[]; key_files: string[]; raw: string } | null;
}

export default function App() {
  const t = useT();
  const { locale } = useLocale();
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [pipeline, setPipeline] = useState<PipelineState>({ phase: 'idle', graph: null, sequenceGraph: null });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [chatWidth, setChatWidth] = useState(420);
  const [codeWidth, setCodeWidth] = useState(480);

  // Action state (lifted from MapperView)
  const [activeAction, setActiveAction] = useState<ActionType | null>(null);
  const [stream, setStream] = useState<StreamState>(INITIAL_STREAM_STATE);

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
      sequenceGraph: pipeline.sequenceGraph,
      savedPlan: pipeline.savedPlan,
      updatedAt: new Date().toISOString(),
    }, null, 2)).catch(() => { /* 预期可忽略：STATE.json 为旁路持久化（尽力而为），写失败不影响会话 */ });
  }, [pipeline.graph, pipeline.savedPlan, projectPath]);

  /**
   * Compute downstream nodes for the selected node.
   * 定位对齐（动作收敛为 explain）后请求体不再使用；保留以维持 RightPanel
   * （应用外壳）既有 props 契约，其清理需与 app-shell 一并调度。
   */
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
    setPipeline({ phase: 'idle', graph: null, sequenceGraph: null, savedPlan: null });
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
            setPipeline({ phase: 'done', graph: state.graph, sequenceGraph: state.sequenceGraph || null, savedPlan: state.savedPlan });
            return;
          }
        }
      } catch { /* no saved state */ }
      setPipeline({ phase: 'idle', graph: null, sequenceGraph: null });
    })();
  }, []);

  useEffect(() => {
    try { window.tracecrew?.file.onProjectOpened((p: string) => handleOpenProject(p)); } catch {
      // 预期可忽略：非 Electron 环境（浏览器开发模式）可能无此 API，订阅失败不影响其余功能
    }
  }, [handleOpenProject]);

  useEffect(() => {
    try {
      window.tracecrew?.file.getProjectPath().then((p: string) => { if (p) setProjectPath(p); });
    } catch {
      // 预期可忽略：非 Electron 环境（浏览器开发模式）可能无此 API，取路径失败不阻断启动
    }
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
          // 动作收敛为 explain（只读，无下游写入面）：不再下发下游节点
          downstream_nodes: [],
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

          // 预期可忽略：data 载荷可能是非 JSON 普通文本，解析失败时原样保留
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
                case 'review_token': {
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
            if (event === 'token' || event === 'review_token') {
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

          // explain 动作成功完成后：把讲解 Markdown 落盘到项目内（best-effort），
          // 并把相对导出路径记入 stream，供结果区显示导出提示
          if (event === 'done' && activeAction === 'explain' && isSuccessfulExplanation(d)) {
            const exportPath = await writeExplanationFile(selectedNodeData, d.message);
            if (exportPath) {
              setStream(prev => ({ ...prev, explainExportPath: exportPath }));
            }
          }
        }
      }
    } catch (e: any) {
      // 错误已通过 setStream 呈现在右侧面板（ActionPanel 错误态渲染 stream.error），故此处不需要 console。
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
        style={{ borderColor: 'var(--ibm-border-subtle)', background: 'var(--ibm-layer-01)' }}>
        <div className="flex items-center gap-2">
          {projectPath ? (
            <span className="text-[11px]" style={{ color: 'var(--ibm-text-placeholder)' }}>{projectPath}</span>
          ) : (
            <span className="text-[11px]" style={{ color: 'var(--ibm-text-disabled)' }}>{t('app.noProject')}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={openFolder}
            className="text-[11px] px-2 py-0.5 rounded transition-colors hover:bg-[rgba(27,42,68,0.045)]"
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
              style={{ width: chatWidth, background: 'var(--ibm-layer-01)', borderColor: 'var(--ibm-border-subtle)' }}>
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
                  sequenceGraph={pipeline.sequenceGraph}
                  phase={pipeline.phase}
                  selectedNode={selectedNode}
                  onSelectNode={handleSelectNode}
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
        className="w-7 h-7 flex items-center justify-center rounded transition-colors hover:bg-[rgba(27,42,68,0.045)]"
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

/* ── explain 导出落盘（定位对齐 §3：讲解产出可带走） ── */

/** 两位补零（导出文件名时间戳用） */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 导出文件名安全清洗：非 [\w一-龥.-] 字符替换为 '_'，截断至 40 字符 */
function sanitizeExportLabel(node: GraphNode): string {
  const source = node.label || node.file || '';
  const cleaned = source.replace(/[^\w一-龥.-]/g, '_').slice(0, 40);
  if (!cleaned) return 'node';
  return cleaned;
}

/** 导出文件名时间戳：本地时间 yyyyMMdd-HHmmss */
function exportTimestamp(date: Date): string {
  const ymd = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;
  const hms = `${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return `${ymd}-${hms}`;
}

/**
 * 判定 SSE done 载荷是否表示 explain 动作成功完成（含可导出的讲解正文）。
 * 服务端只读动作成功 done 形态（runActionStream）：
 *   { success: true, message: <讲解 Markdown>, review_passed: true, call_graph? }
 */
function isSuccessfulExplanation(payload: unknown): payload is { message: string } {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as { success?: unknown; message?: unknown };
  if (p.success !== true) return false;
  return typeof p.message === 'string';
}

/**
 * explain 成功完成后，把讲解 Markdown 落盘到项目内 '.tracecrew/explanations/'，
 * 返回相对导出路径供结果区展示；失败返回 null。
 * best-effort：预期可忽略——落盘失败（无 Electron 环境、磁盘错误等）只告警，
 * 不影响讲解在结果区的展示与其余流程。
 */
async function writeExplanationFile(node: GraphNode, message: string): Promise<string | null> {
  const text = cleanProtocolTags(message).trim();
  if (!text) return null;
  const filePath = `.tracecrew/explanations/${sanitizeExportLabel(node)}-${exportTimestamp(new Date())}.md`;
  try {
    const result = await window.tracecrew.file.writeFile(filePath, text);
    if (!result.success) {
      // 预期可忽略：导出失败不影响讲解展示（文件写入失败经 IPC 返回 success:false 而非抛异常）
      console.error('explain export failed:', result.error, filePath);
      return null;
    }
    return filePath;
  } catch (e) {
    // 预期可忽略：非 Electron 环境等场景写盘不可用，导出失败不影响讲解展示
    console.error('explain export failed:', e);
    return null;
  }
}
