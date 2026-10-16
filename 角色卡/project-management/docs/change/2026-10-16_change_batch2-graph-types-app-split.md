---
id: change-batch2-graph-types-app-split
type: change
title: 批 2 实施提案：图谱类型独立（D2）+ App 编排拆分（D3）+ N2 前端批次
created: "2026-10-16"
updated: "2026-10-16"
timezone: Asia/Shanghai
status: verified
related: [design-architecture-upgrade-plan]
events:
  - date: "2026-10-16"
    kind: created
    summary: 客户「批 2 立项吧」；按方案 §4 批 2 编制合并提案：D2/D3/N2 前端，含两处新文件路径与归属（治理前置）、D1 关闭建议、E2E 复跑评估，待一次确认后治理增补与派发
  - date: "2026-10-16"
    kind: implemented
    summary: 客户确认全部推荐项（批准 D2+D3+N2 前端+O-b1；D1 关闭；E2E 复跑默认不跑）；治理增补两条新路径后按节点表实施（B2-1…B2-6；实施期裁定 B2-F1 一行注释收口 App.tsx:348）
  - date: "2026-10-16"
    kind: verified
    summary: 批末独立验证（B2-V）通过 + B2-F1 增量最小复验：119/119（7 文件）、tsc=0、build=0、check:electron=0、冒烟通过；调度记录 ../scheduling/architecture-batch2.md 收口（seq 1–12）
---

# 批 2 实施提案：图谱类型独立（D2）+ App 编排拆分（D3）+ N2 前端批次

> 状态：**已全部实施并通过独立验证（2026-10-16 闭环）**。依据：《项目架构升级方案》[../design/2026-10-16_design_architecture-upgrade-plan.md](../design/2026-10-16_design_architecture-upgrade-plan.md) §2（D2/D3/N2）与 §4 批 2 行；客户指令「批 2 立项吧」+ 确认全部推荐项。
> 分派规则同前：一份提案一次批准；**两处新文件经治理增补（与 C6 同模式）**后按依赖派发；批末由 project-test 在合并候选上独立验证（B2-V，含 B2-F1 增量最小复验）；**全程未提交 git（提交待客户决定）**。

## 1. 治理前置（请先确认这两条路径与归属）

| 新文件路径 | 归属角色 | 用途 |
| --- | --- | --- |
| `frontend/src/types/graph.ts` | **graph-view** | 图谱共享类型的独立主场：`GraphNode` / `GraphEdge` / `CallGraph` / `ContextMenuAction`（自 `MapCanvas.tsx` 迁出；`NodeStatus`/`SubComponent`/`ImpactScope` 仍来自同目录 `./theme`） |
| `frontend/src/hooks/useAutoExec.ts`（新目录随文件建立） | **agent-pipeline** | App 自动执行编排的独立模块：hook + 可测纯函数（见 §3） |

（如需第三个文件——不建议——会在实施暂停回报；本批预期仅此两处。）

## 2. D2：图谱类型独立（graph-view 主属主不变，类型获得独立主场）

- **现状**：类型定义在 `frontend/src/components/MapCanvas.tsx`（组件文件即事实上的共享模型），**6 处**从组件导入类型（2026-10-16 核查，完整清单）：

| 消费文件 | 现导入 | 归属角色 | 迁移为 |
| --- | --- | --- | --- |
| `App.tsx:5` | `type { CallGraph, GraphNode } from './components/MapCanvas'` | agent-pipeline | `from './types/graph'` |
| `components/ChatPanel.tsx:8` | `type { CallGraph } from './MapCanvas'` | agent-pipeline | 同上 |
| `components/ActionDialog.tsx:4` | `type { GraphNode } from './MapCanvas'` | agent-pipeline | 同上 |
| `components/ActionPanel.tsx:4` | `type { GraphNode } from './MapCanvas'` | agent-pipeline | 同上 |
| `components/RightPanel.tsx:5` | `type { GraphNode } from './MapCanvas'` | app-shell | 同上 |
| `components/MapperView.tsx:2` | `MapCanvas, { type CallGraph } from './MapCanvas'` | graph-view | 默认导入不变；类型改为 `from '../types/graph'` |

- **做法**：① graph-view 新建 `types/graph.ts`（定义迁入；`import type { NodeStatus, SubComponent, ImpactScope } from './theme'`）；② `MapCanvas.tsx` 改为从新文件导入并**保留重导出**（`export type { GraphNode, GraphEdge, CallGraph } from '../types/graph'`）作一层兼容（外部按清单逐个迁移，重导出留待后续批次决定是否移除）；③ 6 处消费按上表迁移（各归属角色执行自己的文件）。
- **验收**：`grep -rn "type .*from '\(\.\./\)*components/MapCanvas'\|MapCanvas'" frontend/src` 中类型导入归零（仅剩 MapperView 的默认导入）；`tsc`=0、`check:electron`=0、`npm test` 114/114、启动冒烟通过。
- **风险**：低（纯类型级）；唯一注意点是重导出期间的「双入口」——以 grep 清单收口。

## 3. D3：App 编排拆分（agent-pipeline）

- **现状（2026-10-16 标记）**：`App.tsx` 745 行，其中自动执行编排域约占 34–473 行——状态 `autoExecRunning/Progress`（34–36）、`execRecords`（39）、`liveOutput`（45）、`topoSortNodes`（223）、`runSingleAction`（249）、`handleExecuteNode`（316）、`handleAutoExec`（359）、`handleStopAutoExec`（469）。
- **抽取边界（迁出 → `hooks/useAutoExec.ts`）**：上述状态与函数整体迁入；**保留在 App**：`PipelineState` 类型、布局/面板组合、`handleActionConfirm`（其 `stream` 状态由 RightPanel 消费，属右侧交互域）、`downstreamNodes`（与选中节点强耦合的 UI 派生值，最小化改动）。`graphRef` 的最新值语义保持不变（hook 内部同步或接收 ref，行为论证见下）。
- **接口草案（实施可按此细化，不得越界）**：

```ts
export interface AutoExecRecord {
  summary: string; review_passed: boolean | null;
  review_feedback?: string; review_issues?: unknown[];
}
export function useAutoExec(opts: {
  projectPath: string | null;
  graphRef: React.RefObject<CallGraph | null>;   // 与现实现同源，供循环内取最新图
  onGraphChange: (g: CallGraph) => void;          // 现 setPipeline({graph})
  locale: string;
  savedPlanRef: React.RefObject<SavedPlan | null>;
}): {
  autoExecRunning: boolean;
  autoExecProgress: { current: number; total: number; currentNodeId: string | null } | null;
  execRecords: Record<string, AutoExecRecord>;
  liveOutput: Record<string, string>;
  runAutoExec: () => Promise<void>;               // 现 handleAutoExec
  stopAutoExec: () => void;                       // 现 handleStopAutoExec
  executeNode: (nodeId: string, action: ActionType) => Promise<void>; // 现 handleExecuteNode
};
// 同文件导出可测纯函数（供 O-b1 单测）：
export function topoSortNodes(nodes: GraphNode[], edges: { from: string; to: string }[]): GraphNode[];
export function collectAffectedExistingIds(graph: CallGraph): Set<string>;
```

- **行为不变性论证（必读）**：本次是**纯搬运 + 纯函数导出**——不重写任何逻辑：SSE 解析、拓扑排序、依赖跳过、状态更新（`graphRef.current` 即时同步再 `setPipeline`）、alert 文案、循环控制（`autoExecStopRef`）逐行保持；hook 内以等价引用（`useRef/useCallback` 依赖数组对齐）承载原闭包捕获。实施报告必须附「迁出函数清单 + 每函数在本文件/新文件的落位对照」。
- **验收**：`tsc`=0、`build`=0、`check:electron`=0、`npm test` 114/114（+O-b1 新增）；启动冒烟通过；**一键执行的交互路径无法在 CLI 驱动**——附 GUI 目视清单（客户）：单节点动作、一键执行（≥2 节点图）、停止按钮三处观察行为不变。
- **风险**：中（核心交互重构）；缓解：纯搬运纪律 + 纯函数单测 + 目视清单。

## 4. N2 前端批次（逐文件清单与处置；口径沿用 C7：输出错误 或 显式注释说明为何可忽略）

**agent-pipeline（`App.tsx` / `ChatPanel.tsx`）**：

| 位置 | 情境 | 建议处置 |
| --- | --- | --- |
| App.tsx:103（`.catch(()=>{})`）、443 类同 | STATE.json/ARCHITECTURE.md 落盘尽力而为 | 显式注释（预期失败、旁路持久化） |
| App.tsx:149 | 无存档状态 | 已有注释，保持 |
| App.tsx:155、161 | 非 Electron 环境订阅/取路径守卫 | 显式注释 |
| App.tsx:289、524 | 非 JSON 行解析兜底 | 显式注释 |
| App.tsx:293、295 | onEvent 回调守卫 | 显式注释（回调抛错不中断流） |
| ChatPanel.tsx:143/154/159 | parseJson 尝试 | 显式注释 |
| ChatPanel.tsx:229 | 文件树获取失败仍可继续 | 显式注释 |
| ChatPanel.tsx:546 | 文件名生成回退 'plan' | 已有注释，保持 |
| ChatPanel.tsx:573/582/700/751 | plans 目录读写/历史读取 best-effort | 显式注释 |
| ChatPanel.tsx:382/215 | — | 已输出日志，保持 |

**app-shell（`SettingsPanel.tsx` / `TitleBar.tsx`）**：88（localStorage 不可用→注释）；114（fetch 设置失败→注释或 console）；132（响应非 JSON→注释）；TitleBar:6（窗口控制 promise→注释）。134 已输出错误，保持。

**project-management（`i18n/index.tsx`）**：30（locale 检测读写 localStorage→显式注释）、65（持久化失败→显式注释）——本角色自改。

**project-data（`CodeViewer.tsx`）**：101——错误已呈现在界面（错误态 + 文案），判定「已处理」；补一行说明注释或不改（实施时定）。

- **验收**：`grep` 白名单核验（`frontend/src` 内不再存在「无输出且无注释」的 catch；允许清单 = 已输出/已注释）；`tsc`/`test`/`check` 门槛不变。

## 5. D1（列表项）：建议关闭——样板对象已不存在

批 1 已删除 `routes/features.ts`、`routes/changes.ts`、`routes/topology.ts`，现仅剩 `routes/agent.ts` 一条**在用**路由——「先做一个薄路由收口样板」的目标已无对象。**建议：D1 标记「不再适用/关闭」**（保留「新代码碰触式收口」的既有约定于 R11 语境；如未来新增路由再评估）。请客户在批准时一并确认关闭。

## 6. E2E 复跑评估（协调者建议项）：**不纳入**，理由如下

无干预 E2E 由 **HTTP/API 驱动**，不走前端渲染与 App 编排——D2/D3 均为**前端重构**，该复跑对它们不构成有效防线（API 路径本批零改动）。替代方案（批末验收）＝常规四门槛 + 启动冒烟 + **GUI 目视清单**（D3 三处交互、D2 图谱渲染惯例）。若客户仍希望保留一次应用级 sanity 轮次，可在批准时指定（成本：一轮 E2E 的 token 与时间）——**默认不跑**。

## 7. 风险与取舍汇总

- D2：低风险（类型级）——取舍：保留 MapCanvas 重导出以兼容（增量迁移，不搞一刀切）。
- D3：中风险（核心交互）——取舍：**只搬不改**；`handleActionConfirm` 与 `downstreamNodes` 留在 App（避免动右侧交互与选中态）；纯函数导出换可测性。
- N2 前端：低风险——取舍：不机械全改（预期失败类用注释而非刷屏日志），口径与 C7 一致。
- 治理前置两路径：与 C6 同模式一次增补。

## 8. 必选 / 选装

**本次必须做**：D2（含 6 处迁移与重导出策略）、D3（含行为不变性对照报告）、N2 前端（逐文件处置表）、批末验收（四门槛 + 冒烟 + GUI 目视清单由客户执行）。

**选装**（默认勾选为建议，待客户确认）：

- [x] O-b1：D3 抽取的纯函数（`topoSortNodes`、`collectAffectedExistingIds`）加单元测试（放 `frontend/test/agent-pipeline/`）。**（默认推荐，待客户确认）**
  好处：一键执行的排序/依赖逻辑获得直接、快速的回归防线（当前仅能靠人工）。不加会怎样：逻辑不变但无测试锁。代价：两条小用例。

## 9. 批末验收（沿用既有口径）

逐项自带测试 → `npm test`（114 + O-b1 新增）全绿 → `tsc`=0 / `build`=0 / `check:electron`=0 → 启动冒烟 → **受影响流程回归由 project-test 在合并候选上独立执行**（含 D2 的 grep 收口与 N2 白名单核验）→ GUI 目视清单交客户（D3 三处 + D2 渲染惯例）。E2E 复跑默认不跑（§6）。

## 10. 实施节点建议与依赖

| 节点 | 角色 | 内容 | 依赖 |
| --- | --- | --- | --- |
| B2-1 | graph-view | 建 `types/graph.ts`；MapCanvas 改用新类型 + 重导出；MapperView import 迁移；N2（无本角色文件在清单内） | 治理增补 |
| B2-2 | agent-pipeline | D2 迁移（App/ChatPanel/ActionDialog/ActionPanel 4 文件）+ N2（App/ChatPanel 注释处置） | B2-1 |
| B2-3 | app-shell | D2 迁移（RightPanel）+ N2（SettingsPanel/TitleBar） | B2-1 |
| B2-4 | project-data | N2（CodeViewer：判定与一行注释） | — |
| B2-5 | project-management | N2（i18n 两处） | — |
| B2-6 | agent-pipeline | D3 抽取（`hooks/useAutoExec.ts` + App 瘦身 + O-b1 单测） | B2-2（同写 App.tsx，串行） |
| B2-V | project-test | 批末独立验证（四门槛 + 冒烟 + grep 收口 + N2 白名单） | B2-1…B2-6 |

（B2-1 后 B2-2/B2-3/B2-4/B2-5 可并行；B2-6 在 B2-2 后。）

## 11. 未决问题（已全部落定）

1. ~~治理增补两条路径（§1）与 **D1 关闭**（§5）请在批准时一并确认。~~ **已确认（2026-10-16）**：治理增补完成（graph-view/agent-pipeline/project-data 三处 Section 1 + 新建 changelog）；**D1 关闭**已入方案。
2. ~~**E2E 复跑**：我方评估为「对本批无有效增益，默认不跑」（§6）——如客户坚持保留，批准时指定。~~ **已定：默认不跑**（客户确认；未执行）。
3. ~~O-b1 取舍。~~ **已批准**：O-b1 纯函数单测已随批落地（`frontend/test/agent-pipeline/autoExecPure.test.ts`）。
4. 实施期新增裁定：`App.tsx:348`（N2 审计发现的边界命中，错误经 `setStream` 呈现在 UI）以**最小修复一行说明注释**收口（节点 B2-F1）；见调度记录 [../scheduling/architecture-batch2.md](../scheduling/architecture-batch2.md) seq 10–11。
