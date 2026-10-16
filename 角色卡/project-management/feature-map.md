# 功能导航 — 项目管理（project-management）

本角色**没有直接负责的业务功能**。跨角色调查、整体架构与集成设计、共享基础资产（i18n）维护、任务调度与协调是本角色的**职责**，不是业务功能，因此本表不列业务功能条目，也不为了填表造功能。

本文件的用途是导航：从这里找到本角色维护的文档、共享资产说明与交付物位置。各业务功能的功能文档归各自的开发角色，见 `角色卡/<role>/docs/feature/<feature-id>.md`。

## 导航

| 去哪里 | 看什么 | 链接 |
| --- | --- | --- |
| 角色职责与可写范围 | 本角色做什么；Section 1 是唯一变更白名单 | [role-card.md](role-card.md)、[boundary.md](boundary.md) |
| 整体架构（当前态） | 系统用途、6 个开发角色分工、请求怎么从界面走到后端、公共契约、Mermaid 角色协作图、已知存量偏差 | [docs/architecture.md](docs/architecture.md) |
| 项目工程规则 | 已确认的构建/端口/环境/测试/质量规则，以及单独一节的「待确认」清单 | [docs/project-rules.md](docs/project-rules.md) |
| 共享组件清单 | 跨角色共享基础资产（i18n）的用途、导出与消费者 | `docs/architecture/shared-components.md`（待创建） |
| 共享代码实际导出与测试证据 | i18n 的导出、依赖与测试证据报告 | `api-spec.md`（待创建） |
| 模块说明与代码位置 | 本角色模块说明 | `functional-description.md`（待创建） |
| 创建与范围变更历史 | 本角色角色创建与范围变更记录 | [changelog.md](changelog.md) |
| 工作线索 | 有日期的续接线索 | [memo.md](memo.md) |

## 共享基础资产（i18n）

本角色是 `frontend/src/i18n/**`（`index.tsx` 与 zh-CN/en/ja/ko 四个语言包）的唯一主属主，其他角色只读引用；共享代码的单元与契约测试归 `frontend/test/project-management/`。共享组件按「只描述一次、消费者链接」的方式维护在 `docs/architecture/shared-components.md`（待创建），本表不重复其内容。

## 本角色的交付物（按边界 Section 1）

- 角色根目录：`changelog.md`、`feature-map.md`、`functional-description.md`（待创建）、`api-spec.md`（待创建）、`memo.md`
- `docs/`：`architecture.md`、`architecture/shared-components.md`（待创建）、`project-rules.md`、`scheduling/`、`meetings/`、设计/变更/修复历史（按需创建）
