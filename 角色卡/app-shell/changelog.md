# Changes: 应用外壳与装配（app-shell）

- 2026-10-16: 边界扩充 — Section 1 新增 `frontend/tsconfig.electron.json`（electron/ 目录独立类型检查配置，ratchet 类型门，批 1/C6；客户经变更提案批准）。Doc: ../project-management/docs/change/2026-10-16_change_batch1-cleanup-hardening.md
- 2026-10-16: 边界扩充 — Section 1 新增 `.gitignore`（限补 `.tracecrew.lock` 忽略行，R1 残留处置；`.codeatlas` 条目与数据处置仍等客户单独指示）。Doc: ../project-management/docs/scheduling/architecture-batch1.md
- 2026-10-16: 边界用途扩充 — `.gitignore` 条目用途由「限 `.tracecrew.lock`」扩为「锁文件与生成物构建缓存（+`*.tsbuildinfo`）」（H1 处置，客户指令）。Doc: ../project-management/docs/scheduling/architecture-batch1.md
- 2026-10-16: 边界扩充 — Section 1 新增根目录 `icon.png`、`icon2.png`（应用图标替换任务，客户指令）。Doc: ../project-management/docs/scheduling/ui-redesign.md
- 2026-10-16: 边界变更 — Section 1 移除 `icon2.png`（零代码引用的重复副本，随图标替换任务按调度记录 seq 4 论证删除）；根 `icon.png` 与 `frontend/public/icon.png` 已替换为新图标（1024 PNG，哈希 `3a1c3b16…`）。Doc: ../project-management/docs/scheduling/ui-redesign.md
