/* ═══════════════════════════════════════════════════════════
   Graph shared types — 调用图/任务依赖图/时序图共用的图谱数据模型。
   主属主：graph-view（图谱视图角色）。于批 2（D2）自 MapCanvas.tsx 迁出，
   由 agent-pipeline（App/ChatPanel/ActionDialog/ActionPanel）与应用外壳
   （RightPanel）只读引用；MapCanvas.tsx 保留一层重导出作迁移期兼容。
   变更这些类型属于属主契约变更：先出设计并通知受影响角色，再实施。
   ═══════════════════════════════════════════════════════════ */

import type { NodeStatus, SubComponent, ImpactScope } from './theme';

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
