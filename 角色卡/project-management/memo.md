# 工作线索 — 项目管理（project-management）

本角色的简短、有日期、有来源的工作事实与续接线索。激活后开始记录；不替代项目规则与任务状态。

- 2026-10-16: 角色由 ANS Governance 在 bootstrap 中创建（2026-10-16 客户验收通过）。角色卡与边界见本目录 `role-card.md`、`boundary.md`。
- 2026-10-16: 基线交付物建立（只写文档，未碰应用代码）：`feature-map.md`、`docs/architecture.md`、`docs/project-rules.md`、`changelog.md`，并更新本 memo。事实基础为通读源码：`electron/`（main/preload/fileManager/settingsStore/server 全部路由与服务）、`frontend/src/`（App 与全部组件、i18n、类型）、`frontend/test/` 三个测试文件、各配置文件与 `start.sh`、其余 5 个角色的角色卡与 memo。
- 2026-10-16: 实测得到的关键事实（详见 `docs/project-rules.md`）：`npm test` 当前红灯（3 文件失败、43 失败 / 50 通过 / 93 例），原因一为 better-sqlite3 按 Electron ABI（132）编译、Node 24（137）下无法实例化，原因二为测试相对重构后的实现过时；端口 19850/5173 为硬编码契约；`.env` 键为 `TRACECREW_LLM_<AGENT>_*` → `TRACECREW_LLM_*` 回退链（Architect 另有借用 Planner 的回退）。
- 2026-10-16: 架构文档末节记录了 10 条已知存量偏差（Express 路由直连 services、组件从 MapCanvas 导入图谱类型、App.tsx 同时承担组合根与流水线编排、features 路由占位、summarizer 未接线、前端预留 remap 事件但后端未发、CodeAtlas 遗留命名、测试红灯、i18n 文案漂移等）；整改与否是客户待决策项。
- 2026-10-16: 测试红灯修复任务（客户指令「让相关角色修复一下现有问题」，范围=测试红灯；架构文档第 8 节偏差不在范围）：完成只读归类 **a=15（ABI）/ b=28（用例过时）/ c=0**，起草修复提案 `docs/fix/2026-10-16_fix_test-suite-red.md`。原型已验证推荐的方案 A（`ELECTRON_RUN_AS_NODE=1` 在 Electron 的 Node 下跑 vitest）：全套可运行、`db.test.ts` 15 例转绿、退出码正确传递（有失败=1）。客户确认前不改任何应用代码/测试/配置、不派发实施。
- 2026-10-16: 测试红灯修复任务**已闭环（13:42）**：M1–M8 全部 verified（M1 app-shell；M2/M4/M7 project-data；M3/M8 agent-pipeline；M6 本角色；M5 project-test 独立验证）；M5 结论=通过/无失败/无无法运行（95/95 两连跑、零 skip/only、启动冒烟 health ok、候选物哈希逐字一致、收尾只杀自有进程）；本上下文抽查复跑一致（含自起自停冒烟）。两份 fix 文档置 `verified`；R10/T1 与架构 §8 第 9 条同步闭环。调度记录 `docs/scheduling/test-suite-red-fix.md`（事件 seq 1–22、收口节）。关键实测：全套 `npm test` **95/95、退出码 0**；缺陷 #1/#2 均独立复现、自建驱动运行时验证。
- 2026-10-16: 工作树现存未提交变更（等待客户后续对提交/发布的决定，R14：验证不授权提交）：7 个应用文件 M + `frontend/test/agent-pipeline/`（新测试目录）；`角色卡/` 整体仍是未跟踪（含本角色全部文档）。
- 2026-10-16: 架构升级方案产出：`docs/design/2026-10-16_design_architecture-upgrade-plan.md`（候选设计，待客户评审）——§8 十条偏差逐条「保持现状/升级」评估（D1–D10）+ 新增候选 N1（electron 类型门，试算基线 81 项）/N2（静默 catch 约 30 处）/N3–N5；分三批规划（批 1 卫生与防复发、批 2 解耦、批 3 结构）；批 1 前置 = 当前修复任务闭环。新实测供复用的证据：`/features`、`/topology`、`/changes`、`getUrl` 前端零消费者；`backend/` 目录不存在（package.json 仍有引用）；`.codeatlas/` 含 4 组历史备份。
- 下一步建议：1) 跟进客户对《项目架构升级方案》的评审与批次选择（三个产品问题：功能分析 D5 / 摘要缓存 D6 / remap D7；打包实测 N5；批 1 前置＝本任务已闭环，已满足）；2) 各角色 `feature-map.md` 与 `docs/architecture/shared-components.md`、`api-spec.md` 仍待创建（前者归各角色，后两者归本角色）；3) 提交/发布决定待客户（验证已通过但 R14 不授权提交）。
