# 模块边界文档 — 固定测试（project-test）

本文件仅包含 Section 1：本角色的可修改文件与目录白名单，是本角色唯一的变更授权来源。同名 `boundary.yaml` 只是同步副本，不构成第二授权源。

## Section 1: Modifiable files and directories

| Type | Operable path | Function |
| --- | --- | --- |
| Owned directory | `frontend/test/project-test/` | 本角色的专属测试目录：跨角色联调、完整流程、回归用例及测试夹具与辅助代码；测试辅助代码不得被生产代码引用 |
| Single file | `角色卡/project-test/memo.md` | 本角色的简短事实与续接线索 |
| Single file | `角色卡/project-test/feature-map.md` | 功能导航（本角色无直接负责的业务功能，链接受测角色功能文档） |
| Single file | `角色卡/project-test/changelog.md` | 本角色的创建与范围变更历史 |
| Conditional directory | `角色卡/project-test/docs/` | 测试方案、问题记录与测试报告（按类型日期化） |

**未在本 Section 1 中列出、也不被已接受目录覆盖的文件默认只读。** 要修改未覆盖的文件，必须先提交 Section 1 更新提案，并经过与代码变更相同的证据与验收门。

在已接受的目录范围内新增或删除普通文件不需要重写 Section 1；新增目录授权、改变归属，或增删单独列出的路径，必须由治理角色（ANS Governance）先更新 Section 1。

本角色可以只读访问本次任务相关的全部源码、功能文档、已确认方案、共享组件清单与其他角色的测试结果；不能修改业务源码、`frontend/src/i18n/**`、其他角色的私有代码、单元测试与测试夹具、构建配置（`package.json`、vite/vitest/tsconfig 等）、角色卡与边界。需要调整运行环境时，交项目管理角色安排应用外壳角色处理。
