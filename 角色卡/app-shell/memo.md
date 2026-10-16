# 工作线索 — 应用外壳与装配（app-shell）

本角色的简短、有日期、有来源的工作事实与续接线索。激活后开始记录。

- 2026-10-16: 角色由 ANS Governance 在 bootstrap 中创建（2026-10-16 客户验收通过）。启动路径：`npm run electron:dev`（`frontend/`）→ vite-plugin-electron 构建 `dist-electron` → `electron/main.ts` 启动窗口并内嵌 Express（19850）；开发前端 5173。
- 2026-10-16: `.env` 在 `main.ts` 启动时经 dotenv 加载（项目根目录）；设置 API 保存后同步更新 `process.env` 并调用 `agentService.reload()`，无需重启。
