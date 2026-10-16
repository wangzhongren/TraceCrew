# 工作线索 — 图谱视图（graph-view）

本角色的简短、有日期、有来源的工作事实与续接线索。激活后开始记录。

- 2026-10-16: 角色由 ANS Governance 在 bootstrap 中创建（2026-10-16 客户验收通过）。核心入口：`frontend/src/components/MapCanvas.tsx`（图谱类型主属主）、`frontend/src/components/MapperView.tsx`（三图容器）。
- 2026-10-16: `types/theme.ts` 当前仅被 MapCanvas/MapperView 引用，按私有模型维护；若被其他角色引用需登记为共享组件。
