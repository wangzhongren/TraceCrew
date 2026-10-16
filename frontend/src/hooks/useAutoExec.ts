/* ═══════════════════════════════════════════════════════════
   App 自动执行编排 hook — 批 2（D3）自 App.tsx 抽取，调度节点 B2-6。
   纯搬运：拓扑排序、依赖跳过、SSE 解析与事件回调、状态更新顺序（graphRef.current
   即时同步再 onGraphChange）、alert 文案、console 日志、停止控制（autoExecStopRef）
   均保持原 App.tsx 实现逐行不变；原先由 App 闭包捕获的引用（graphRef /
   savedPlanRef / setStream / actionAbortRef / onGraphChange）改为入参承载。
   同文件导出两个可测纯函数（O-b1）：topoSortNodes、collectAffectedExistingIds。
   ═══════════════════════════════════════════════════════════ */

import { useState, useCallback, useRef } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { CallGraph, GraphNode } from '../types/graph';
import type { ActionType } from '../components/ActionDialog';
import { type StreamState, INITIAL_STREAM_STATE } from '../components/ActionPanel';

/** 单节点执行记录（原 App.tsx 内联类型迁出；review_issues 按提案 §3 为 unknown[]） */
export interface AutoExecRecord {
  summary: string;
  review_passed: boolean | null;
  review_feedback?: string;
  review_issues?: unknown[];
}

/** 保存的计划上下文（与 App PipelineState.savedPlan 同形），runSingleAction 经 ref 读取 */
export interface AutoExecPlanContext {
  plan_summary: string;
  steps: any[];
  key_files: string[];
  raw: string;
}

/** useAutoExec 入参：前五项来自提案 §3 草案；后两项承载原 App 闭包捕获（签名微调，边界不变） */
export interface AutoExecOptions {
  projectPath: string | null;
  graphRef: RefObject<CallGraph | null>;
  onGraphChange: (g: CallGraph) => void;
  locale: string;
  savedPlanRef: RefObject<AutoExecPlanContext | null | undefined>;
  setStream: Dispatch<SetStateAction<StreamState>>;
  actionAbortRef: RefObject<AbortController | null>;
}

/** useAutoExec 返回值：提案 §3 草案字段 + setExecRecords（供 App 既有自动保存 effect 写入） */
export interface AutoExecController {
  autoExecRunning: boolean;
  autoExecProgress: { current: number; total: number; currentNodeId: string | null } | null;
  execRecords: Record<string, AutoExecRecord>;
  liveOutput: Record<string, string>;
  setExecRecords: Dispatch<SetStateAction<Record<string, AutoExecRecord>>>;
  runAutoExec: () => Promise<void>;
  stopAutoExec: () => void;
  executeNode: (nodeId: string, action: ActionType) => Promise<void>;
}

// Topological sort nodes by dependency edges.
// Only edges whose BOTH endpoints are in `nodes` count as dependencies.
export function topoSortNodes(nodes: GraphNode[], edges: { from: string; to: string }[]): GraphNode[] {
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
}

/** Collect existing nodes that are affected by a bug → should be executed too（原 handleAutoExec 内联块，行为等价） */
export function collectAffectedExistingIds(graph: CallGraph): Set<string> {
  const affectedExistingIds = new Set<string>();
  for (const node of graph.nodes) {
    if (node.impact_scope?.affected_nodes) {
      for (const nid of node.impact_scope.affected_nodes) {
        const target = graph.nodes.find(n => n.id === nid);
        if (target && target.status === 'existing') {
          affectedExistingIds.add(nid);
        }
      }
    }
  }
  return affectedExistingIds;
}

/**
 * App 自动执行编排（自 App.tsx 抽取，纯搬运；批 2 / D3，调度节点 B2-6）。
 * 入参承载原 App 闭包捕获的引用：
 * - graphRef：循环内读取最新图谱（App 每次渲染已同步 .current）；
 * - onGraphChange：现 setPipeline 的 graph 更新（App 的 handleGraphChange）；
 * - savedPlanRef：动作请求读取当前 savedPlan（避免过期闭包）；
 * - setStream / actionAbortRef：执行前重置右侧动作流并中止遗留 SSE（原 App 闭包捕获）。
 */
export function useAutoExec(opts: AutoExecOptions): AutoExecController {
  const { projectPath, graphRef, onGraphChange, locale, savedPlanRef, setStream, actionAbortRef } = opts;

  // Auto-exec state
  const [autoExecRunning, setAutoExecRunning] = useState(false);
  const [autoExecProgress, setAutoExecProgress] = useState<{ current: number; total: number; currentNodeId: string | null } | null>(null);
  const autoExecStopRef = useRef(false);

  // Per-node execution records (for card expand)
  const [execRecords, setExecRecords] = useState<Record<string, AutoExecRecord>>({});

  // Live output for currently executing node
  const [liveOutput, setLiveOutput] = useState<Record<string, string>>({});

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
          // 预期可忽略：data 载荷可能是非 JSON 普通文本，解析失败时原样保留
          const d = typeof data2 === 'string' ? (() => { try { return JSON.parse(data2); } catch { return data2; } })() : data2;
          if (event2 === 'token' || event2 === 'review_token') {
            onEvent?.({ type: 'token', data: d });
          } else if (event2 === 'phase') {
            try { onEvent?.({ type: 'phase', data: d.phase }); } catch {
              // 预期可忽略：onEvent 为 UI 回调（刷新实时输出），其抛错不应中断 SSE 流处理
            }
          } else if (event2 === 'tools') {
            try { onEvent?.({ type: 'tools', data: `${d.ops?.length || 0} 个工具操作` }); } catch {
              // 预期可忽略：onEvent 为 UI 回调（刷新实时输出），其抛错不应中断 SSE 流处理
            }
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
        setLiveOutput(prev => ({ ...prev, [nodeId]: (prev[nodeId] || '') + `\n${ev.data}\n` }));
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
        onGraphChange({ nodes: updatedNodes, edges: g.edges });
      }
    }

    setAutoExecProgress(null);
  }, [projectPath, runSingleAction, onGraphChange]);

  // Auto-execute all pending tasks in dependency order
  const handleAutoExec = useCallback(async () => {
    try {
      const graph = graphRef.current;
      if (!graph || !projectPath) return;

      // Collect existing nodes that are affected by a bug → should be executed too
      const affectedExistingIds = collectAffectedExistingIds(graph);

      const pending = graph.nodes.filter(n =>
        n.status !== 'done' && (n.status !== 'existing' || affectedExistingIds.has(n.id))
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
      // affected existing nodes → fix; planned_new / problem / planned_change → develop
      const action = (node.status === 'existing' && affectedExistingIds.has(node.id)) ? 'fix' : 'develop';
      const result = await runSingleAction(node, action, projectPath, (ev) => {
        if (ev.type === 'token') {
          setLiveOutput(prev => ({ ...prev, [node.id]: (prev[node.id] || '') + ev.data }));
        } else if (ev.type === 'phase') {
          setLiveOutput(prev => ({ ...prev, [node.id]: (prev[node.id] || '') + `\n\n[${ev.data}]\n` }));
        } else if (ev.type === 'tools') {
          setLiveOutput(prev => ({ ...prev, [node.id]: (prev[node.id] || '') + `\n${ev.data}\n` }));
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
            n.id === node.id ? { ...n, status: 'done' as const, detail: (n.detail || '') + '\n✓ 已完成' } : n
          );
          const newGraph = { nodes: updatedNodes, edges: g.edges };
          graphRef.current = newGraph; // sync immediately for next loop iteration
          onGraphChange(newGraph);
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
  }, [projectPath, runSingleAction, onGraphChange]);

  const handleStopAutoExec = useCallback(() => {
    autoExecStopRef.current = true;
    setAutoExecRunning(false);
    setAutoExecProgress(null);
  }, []);

  return {
    autoExecRunning,
    autoExecProgress,
    execRecords,
    liveOutput,
    setExecRecords,
    runAutoExec: handleAutoExec,
    stopAutoExec: handleStopAutoExec,
    executeNode: handleExecuteNode,
  };
}
