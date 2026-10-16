# 模块边界文档 — 应用外壳与装配（app-shell）

本文件仅包含 Section 1：本角色的可修改文件与目录白名单，是本角色唯一的变更授权来源。同名 `boundary.yaml` 只是同步副本，不构成第二授权源。

## Section 1: Modifiable files and directories

| Type | Operable path | Function |
| --- | --- | --- |
| Single file | `electron/main.ts` | Electron 主进程入口：窗口创建、IPC 处理器注册、生命周期清理、内嵌后端启动 |
| Single file | `electron/preload.ts` | IPC 桥：`window.tracecrew` 契约暴露（file/shell/backend/window 命名空间） |
| Single file | `electron/settingsStore.ts` | LLM 设置持久化：读写根目录 `.env`（每 Agent 键与全局回退键） |
| Single file | `electron/server/index.ts` | Express 后端装配：中间件、路由挂载、设置 API、健康检查、SPA 静态服务 |
| Single file | `frontend/src/main.tsx` | React 入口 |
| Single file | `frontend/index.html` | HTML 入口 |
| Single file | `frontend/src/index.css` | 全局样式 |
| Single file | `frontend/src/components/TitleBar.tsx` | 无边框窗口标题栏（最小化/最大化/关闭、拖拽区） |
| Single file | `frontend/src/components/ResizeHandle.tsx` | 布局拖拽把手 |
| Single file | `frontend/src/components/RightPanel.tsx` | 右侧面板组合容器（代码查看器 + 操作执行面板） |
| Single file | `frontend/src/components/SettingsPanel.tsx` | LLM 设置面板 UI（每 Agent API Key/Base URL/模型） |
| Single file | `frontend/src/types/electron.d.ts` | `window.tracecrew` 契约类型声明（与 preload.ts 同步） |
| Single file | `frontend/package.json` | 依赖与脚本、electron-builder 打包配置 |
| Single file | `frontend/package-lock.json` | 依赖锁文件（随 npm 操作更新） |
| Single file | `frontend/vite.config.ts` | 构建配置：React、electron 插件、开发代理（5173 → 19850）、SSE 透传 |
| Single file | `frontend/vitest.config.ts` | 测试运行器配置 |
| Single file | `frontend/tsconfig.json` | TypeScript 配置 |
| Single file | `frontend/tailwind.config.ts` | Tailwind 配置 |
| Single file | `frontend/postcss.config.js` | PostCSS 配置 |
| Single file | `start.sh` | macOS/Linux 启动脚本（清理、加锁、启动与健康检查） |
| Single file | `start.bat` | Windows 启动脚本 |
| Single file | `frontend/public/icon.png` | 应用图标资源 |
| Owned directory | `frontend/test/app-shell/` | 本角色单元测试的归属目录；不放置生产代码 |
| Single file | `角色卡/app-shell/memo.md` | 本角色的简短事实与续接线索 |
| Single file | `角色卡/app-shell/feature-map.md` | 功能导航：用途、状态与文档链接 |
| Single file | `角色卡/app-shell/changelog.md` | 本角色的创建与范围变更历史 |
| Single file | `角色卡/app-shell/functional-description.md` | 模块说明与代码位置 |
| Single file | `角色卡/app-shell/api-spec.md` | IPC 契约、后端装配导出与启动冒烟证据 |
| Conditional directory | `角色卡/app-shell/docs/` | 本角色的设计/功能/变更/修复历史文档 |

**未在本 Section 1 中列出、也不被已接受目录覆盖的文件默认只读。** 要修改未覆盖的文件，必须先提交 Section 1 更新提案，并经过与代码变更相同的证据与验收门。

在已接受的目录范围内新增或删除普通文件不需要重写 Section 1；新增目录授权、改变归属，或增删单独列出的路径，必须由治理角色（ANS Governance）先更新 Section 1。

本角色的只读依赖（引用其公开能力，不修改其文件）：`electron/fileManager.ts`、`electron/server/services/db.ts`（项目数据）、`electron/server/services/agent.ts` 的 `agentService.reload`（agent-pipeline）、`frontend/src/i18n/**`（项目管理）、`frontend/src/components/CodeViewer.tsx`（项目数据）、`frontend/src/components/ActionPanel.tsx`（agent-pipeline）、`frontend/src/components/MapCanvas.tsx` 的图谱类型（图谱视图）。
