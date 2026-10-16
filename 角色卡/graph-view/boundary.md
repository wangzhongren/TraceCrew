# 模块边界文档 — 图谱视图（graph-view）

本文件仅包含 Section 1：本角色的可修改文件与目录白名单，是本角色唯一的变更授权来源。同名 `boundary.yaml` 只是同步副本，不构成第二授权源。

## Section 1: Modifiable files and directories

| Type | Operable path | Function |
| --- | --- | --- |
| Single file | `frontend/src/types/graph.ts` | 图谱共享类型（`GraphNode`/`GraphEdge`/`CallGraph`/`ContextMenuAction`；MapCanvas 保留重导出兼容；主属主） |
| Single file | `frontend/src/components/MapCanvas.tsx` | 调用图画布渲染与交互；图谱共享类型重导出（兼容层，主属主见 `types/graph.ts`） |
| Single file | `frontend/src/components/MapperView.tsx` | 三图视图容器：调用图/任务依赖图/时序图切换与数据装配 |
| Single file | `frontend/src/types/theme.ts` | 图谱视觉常量与节点状态模型（`NodeStatus`、颜色、图标、标签） |
| Owned directory | `frontend/test/graph-view/` | 本角色单元与层内契约测试的归属目录；不放置生产代码 |
| Single file | `角色卡/graph-view/memo.md` | 本角色的简短事实与续接线索 |
| Single file | `角色卡/graph-view/feature-map.md` | 功能导航：用途、状态与文档链接 |
| Single file | `角色卡/graph-view/changelog.md` | 本角色的创建与范围变更历史 |
| Single file | `角色卡/graph-view/functional-description.md` | 模块说明与代码位置 |
| Single file | `角色卡/graph-view/api-spec.md` | 实际导出（含图谱共享类型）、依赖与测试证据 |
| Conditional directory | `角色卡/graph-view/docs/` | 本角色的设计/功能/变更/修复历史文档 |

**未在本 Section 1 中列出、也不被已接受目录覆盖的文件默认只读。** 要修改未覆盖的文件，必须先提交 Section 1 更新提案，并经过与代码变更相同的证据与验收门。

在已接受的目录范围内新增或删除普通文件不需要重写 Section 1；新增目录授权、改变归属，或增删单独列出的路径，必须由治理角色（ANS Governance）先更新 Section 1。

本角色的只读依赖（引用其公开能力，不修改其文件）：`frontend/src/i18n/**`（项目管理）。`frontend/src/types/graph.ts` 的图谱共享类型是本角色主属主的共享抽象（`MapCanvas.tsx` 保留重导出兼容），被 agent-pipeline（`App.tsx`、`ChatPanel.tsx`、`ActionDialog.tsx`、`ActionPanel.tsx`）与应用外壳（`RightPanel.tsx`）只读引用；变更类型属主契约会使其下游证据失效，必须先出设计并通知受影响角色。
