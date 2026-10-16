# 模块边界文档 — 项目数据与文件（project-data）

本文件仅包含 Section 1：本角色的可修改文件与目录白名单，是本角色唯一的变更授权来源。同名 `boundary.yaml` 只是同步副本，不构成第二授权源。

## Section 1: Modifiable files and directories

| Type | Operable path | Function |
| --- | --- | --- |
| Single file | `electron/fileManager.ts` | 文件读写/行级编辑/搜索/备份恢复、Shell 执行与任务日志（Provider） |
| Single file | `electron/server/services/db.ts` | SQLite 持久化：features、changes、meta（Provider） |
| Single file | `electron/server/types.ts` | 服务端共享请求/响应类型（FeatureNode、AgentRequest 等，Model） |
| Single file | `frontend/src/components/CodeViewer.tsx` | 代码查看器：文件内容展示、行选择与滚动定位 |
| Single file | `frontend/test/db.test.ts` | `services/db.ts` 的单元测试（既有） |
| Single file | `frontend/test/fileManager.test.ts` | `fileManager.ts` 的单元测试（既有） |
| Owned directory | `frontend/test/project-data/` | 本角色新增单元与层内契约测试的归属目录；不放置生产代码 |
| Single file | `角色卡/project-data/memo.md` | 本角色的简短事实与续接线索 |
| Single file | `角色卡/project-data/feature-map.md` | 功能导航：用途、状态与文档链接 |
| Single file | `角色卡/project-data/changelog.md` | 本角色的创建与范围变更历史 |
| Single file | `角色卡/project-data/functional-description.md` | 模块说明与代码位置 |
| Single file | `角色卡/project-data/api-spec.md` | 实际导出（fileManager/db 对外函数与表结构）、依赖与测试证据 |
| Conditional directory | `角色卡/project-data/docs/` | 本角色的设计/功能/变更/修复历史文档 |

**未在本 Section 1 中列出、也不被已接受目录覆盖的文件默认只读。** 要修改未覆盖的文件，必须先提交 Section 1 更新提案，并经过与代码变更相同的证据与验收门。

在已接受的目录范围内新增或删除普通文件不需要重写 Section 1；新增目录授权、改变归属，或增删单独列出的路径，必须由治理角色（ANS Governance）先更新 Section 1。

本角色的只读依赖（引用其公开能力，不修改其文件）：`frontend/src/i18n/**`（项目管理）。`fileManager.ts` 与 `db.ts` 的导出函数/表结构是本角色主属主的基础设施契约，被 agent-pipeline（工具执行）与应用外壳（IPC、`closeDatabase`、健康检查）引用；变更契约会使其下游证据失效，必须先出设计并通知受影响角色。
