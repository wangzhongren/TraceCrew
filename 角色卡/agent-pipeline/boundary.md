# 模块边界文档 — Agent 协作流水线（agent-pipeline）

本文件仅包含 Section 1：本角色的可修改文件与目录白名单，是本角色唯一的变更授权来源。同名 `boundary.yaml` 只是同步副本，不构成第二授权源。

## Section 1: Modifiable files and directories

| Type | Operable path | Function |
| --- | --- | --- |
| Single file | `electron/server/routes/agent.ts` | Agent 对话/分类/命名/计划/动作的 HTTP 与 SSE 接口（Interface） |
| Single file | `electron/server/services/agent.ts` | 多 Agent 编排与转换核心：流式对话、计划流、子代理、动作执行、工具调用（Pipeline/Service） |
| Single file | `frontend/src/App.tsx` | 前端组合根：阶段状态机、图谱数据下发、面板组合（自动执行编排见 hooks/useAutoExec.ts） |
| Single file | `frontend/src/hooks/useAutoExec.ts` | App 自动执行编排 hook（批 2/D3 抽取：拓扑排序、依赖检查、逐节点执行与记录持久化；含可测纯函数） |
| Single file | `frontend/src/components/ChatPanel.tsx` | 对话面板：Agent 时间线、流式接收与计划/审查卡片挂载 |
| Single file | `frontend/src/components/PlanCard.tsx` | 计划卡片展示 |
| Single file | `frontend/src/components/ReviewCard.tsx` | 审查卡片展示 |
| Single file | `frontend/src/components/ActionDialog.tsx` | 操作类型对话框（修复/测试/重构/解释/开发） |
| Single file | `frontend/src/components/ActionPanel.tsx` | 操作执行面板：动作/审查/修复/重绘流式时间线 |
| Single file | `frontend/test/agent.test.ts` | `services/agent.ts` 的单元测试（既有） |
| Owned directory | `frontend/test/agent-pipeline/` | 本角色单元与层内契约测试的归属目录；不放置生产代码 |
| Single file | `角色卡/agent-pipeline/memo.md` | 本角色的简短事实与续接线索 |
| Single file | `角色卡/agent-pipeline/feature-map.md` | 功能导航：用途、状态与文档链接 |
| Single file | `角色卡/agent-pipeline/changelog.md` | 本角色的创建与范围变更历史 |
| Single file | `角色卡/agent-pipeline/functional-description.md` | 模块说明与代码位置 |
| Single file | `角色卡/agent-pipeline/api-spec.md` | 实际导出、依赖、装配说明与测试证据 |
| Conditional directory | `角色卡/agent-pipeline/docs/` | 本角色的设计/功能/变更/修复历史文档 |

**未在本 Section 1 中列出、也不被已接受目录覆盖的文件默认只读。** 要修改未覆盖的文件，必须先提交 Section 1 更新提案，并经过与代码变更相同的证据与验收门。

在已接受的目录范围内新增或删除普通文件不需要重写 Section 1；新增目录授权、改变归属，或增删单独列出的路径，必须由治理角色（ANS Governance）先更新 Section 1。

本角色的只读依赖（引用其公开能力，不修改其文件）：`electron/fileManager.ts`、`electron/server/services/db.ts`（项目数据）、`frontend/src/i18n/**`（项目管理）、`frontend/src/types/graph.ts` 的图谱共享类型（图谱视图；MapCanvas 重导出兼容）、`frontend/src/components/RightPanel.tsx` / `SettingsPanel.tsx` / `TitleBar.tsx` / `ResizeHandle.tsx`（应用外壳）。需要它们变化时向项目管理角色提出请求。
