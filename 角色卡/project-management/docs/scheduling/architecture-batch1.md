# 调度记录 — architecture-batch1（架构升级批 1：卫生清理与防复发）

> 本文件是本任务的唯一全局记录，由项目管理上下文作为唯一写入者维护（本环境无 task_ops CLI，手工维护）。
> planRevision: 1 ｜ 对应实施提案：`../change/2026-10-16_change_batch1-cleanup-hardening.md`（**待客户批准**）
> 方案依据：`../design/2026-10-16_design_architecture-upgrade-plan.md`（客户 2026-10-16 决策已记录）
> 状态取值：pending / ready / running / awaiting-verification / verified / failed / blocked / cancelled。

## 1. 任务与授权

- **任务**：批 1 卫生清理与防复发 —— C1（D8 命名/打包引用）、C2（D10 i18n）、C3（D5 路由与 getUrl 清理）、C4（D6 summarizer 删除）、C5（D7 remap 清理）、C6（N1 类型门 + ratchet）、C7（N2 electron catch 批次）、C8（N5 打包实测）；批末独立验证 B1-V。
- **授权记录（2026-10-16，经协调者转呈的客户决策）**：批 1 立项（D8/D10/N1/N2/N5）；D5→清理、D6→删除、D7→清理；N1 用 ratchet；`.codeatlas/` 数据默认不动；N5/D8 先实测打包。
- **实施授权状态**：**待客户批准合并提案**——批准后按角色派发；C6 另需 **Governance 先把 `frontend/tsconfig.electron.json` 增补进 app-shell Section 1**。

## 2. 节点表（节点 = 角色 + 阶段 + 可观察交付物）

| 节点 | 角色 | 交付物 | 写入范围（精确） | 前置 | 状态 |
| --- | --- | --- | --- | --- | --- |
| B1-1 | app-shell | C8 打包实测 → C1 命名/引用 → C3 装配部分（摘挂载 + getUrl） | `frontend/package.json`、`start.sh`、`start.bat`、`electron/server/index.ts`、`electron/preload.ts`、`frontend/src/types/electron.d.ts` | 提案批准（已满足） | **verified**（attempt 1） |
| B1-2 | project-data | C3 文件删除（features/changes）+ C4（summarizer 与 db 相关导出/DDL）+ C7（fileManager:574） | `electron/server/routes/features.ts`、`routes/changes.ts`（删除）、`services/summarizer.ts`（删除）、`services/db.ts`、`fileManager.ts` | B1-1（已满足） | **verified**（attempt 1） |
| B1-3 | graph-view | C3 文件删除（topology）+ X1-B（MapperView phase 联合，客户已批） | `electron/server/routes/topology.ts`（删除）、`frontend/src/components/MapperView.tsx` | B1-1（已满足） | **verified**（attempt 1；与 X1-B 同一 worker） |
| B1-4 | agent-pipeline | C5 代码（App/ActionPanel 去 remap）+ C7（agent.ts 6 处逐处处置） | `frontend/src/App.tsx`、`components/ActionPanel.tsx`、`electron/server/services/agent.ts` | 提案批准（已满足） | **verified**（attempt 1；口径修正见 §6） |
| B1-5 | project-management | C2（i18n 文案扫描修正）+ C5 的 i18n 键删除 + O-b1（i18n 一致性测试，已获批） | `frontend/src/i18n/*.json`、`frontend/test/project-management/**` | C5 代码移除后（键删除前核验无消费者） | **verified**（本上下文执行） |
| B1-6 | app-shell | C6 类型门：`tsconfig.electron.json` + `check:electron` 脚本（+ settingsStore 注释 nano 项） | `frontend/tsconfig.electron.json`（治理已增补 ✓）、`frontend/package.json`、`electron/settingsStore.ts`（注释） | B1-1（已满足） | **verified**（attempt 1） |
| B1-V | project-test | 批末独立验证（回归 + 冒烟 + 逐项 grep + 不变式复查） | `frontend/test/project-test/**`（如需）、本角色 docs | C1–C8 全部完成 | **verified**（attempt 1） |
| B1-D | project-management | 规则与文档更新（ratchet 政策与基线 0、三处口径修正、冻结哈希完整清单、R/H/X/Z 归目、方案/提案收口） | 本角色 docs | B1-V（✓）、X2-A、X2-B | **verified**（2026-10-16 完成） |
| X1-A | agent-pipeline | X1 第 1/2/4 条（App 未用 GraphEdge、App `sequenceGraph: null`、ActionPanel 未用 actionColor） | `frontend/src/App.tsx`、`frontend/src/components/ActionPanel.tsx` | 客户批准 X1（已满足） | **verified**（attempt 1） |
| X1-C | app-shell | X1 第 5 条（RightPanel 未用 `dragging`） | `frontend/src/components/RightPanel.tsx` | 客户批准 X1（已满足） | **verified**（attempt 1） |
| R1-N | app-shell | `.gitignore` 补 `.tracecrew.lock` 忽略行（治理已赋权；`.codeatlas` 条目与数据不动） | `.gitignore` | 治理赋权（已满足） | **verified**（attempt 1） |
| X2-A | app-shell | X2：`main.ts:20`、`server/index.ts:6` 未用 import 移除 + `tsconfig.electron.json` 补 `noUnusedLocals`/`noUnusedParameters` | `electron/main.ts`、`electron/server/index.ts`、`frontend/tsconfig.electron.json` | 客户批准 X2（已满足）+ B1-V 完成核验（已满足） | **verified**（attempt 1） |
| X2-B | agent-pipeline | X2：`agent.ts:1549` `reviewAgentMsg` 未用处置（若属漏接意图则暂停回报） | `electron/server/services/agent.ts` | 客户批准 X2（已满足）+ B1-V 完成核验（已满足） | **verified**（attempt 1） |

**写集冲突检查**：B1-1 与 B1-4 不相交；B1-2/B1-3 同写 `server/index.ts` 吗——不，`server/index.ts` 只在 B1-1；B1-2/B1-3 只删各自文件；B1-5 只写 i18n 与自身测试目录；B1-6 只写新配置与 package.json（与 B1-1 的 package.json 串行：B1-6 在 B1-1 之后，避免同文件并行）。全部路径落各角色既有 Section 1（唯一例外是 C6 的新配置文件，已标注治理前置）。

## 3. 状态表

| 节点 | 执行状态 | 反馈摘要 | 下一步 / 责任方 | 证据 |
| --- | --- | --- | --- | --- |
| B1-1 | verified | 核验通过：6 文件 diff 逐项吻合（health `tracecrew`、锁名/横幅、去 `../backend` 与 extraResources、去 getUrl×2、摘挂载×3）；C8 两次实测（attempt1 为宿主钥匙串签名环境问题、已隔离证明与本项目无关；attempt2 退出码 0、产物齐全）——本上下文复验 `codesign --verify --deep --strict`=0、release 产物在册；`npm test` 98/98；冒烟 health=200 且 service=`tracecrew`、三路由 404、5173=200（worker 证据） | —（已完成） | reportId b1-1-appshell-attempt1；本上下文复验记录 |
| B1-2 | verified | 核验通过：3 文件删除（features 93/ changes 31/ summarizer 151 行，删除前哈希记录在案）；db.ts −89 行（file_summaries 族）且其余导出逐项复核在册；fileManager C7 改为输出错误（logFile 纯路径上提不影响行为、不抛出）；grep 零残留；`npm test` 98/98；tsc=0；check:electron=0 | —（已完成） | reportId b1-2-project-data-attempt1；本上下文复验（哈希 `ee77245d…`/`6300126d…` 一致） |
| B1-3 | verified | 核验通过：topology.ts 已删（routes/ 仅余 agent.ts）；MapperView 恰 1 行（`0b843f1f…` 一致）、零运行时变化（phase 仅 EmptyState 消费）；**tsc = 0 条错误、退出码 0（5→0）**；`npm test` 98/98。观察项 A（tsbuildinfo）归档为 H1 | —（已完成） | reportId b1-3-graph-view-attempt1；本上下文复验 |
| B1-4 | verified | 核验通过：3 文件哈希逐字一致；diff 逐 hunk 审阅（App 两处最小删除；ActionPanel phaseLabel 逐 case 语义等价；agent.ts 6 处 catch 显式注释、零行为变化）；`remap`/`action.remapping` 代码侧零命中；tsc 与纯净 HEAD 逐字一致（5 条存量）；`npm test` 95/95。**裁定：验收口径修正为「新增类型错误=0」**（基线 5 条为 HEAD 存量，M3 早前亦独立观察） | —（已完成） | reportId b1-4-agent-pipeline-attempt1；本上下文复跑记录 |
| B1-5 | verified | 本上下文执行并核验：4 语言包 `chat.pipelineFlow` 补 Architect、`graph.emptyAction` 同步修正、`action.remapping` 删除（代码侧零引用先证）、O-b1 一致性测试（3 例）新增；4 语言包均 150 键对称；`npm test` = **98/98** 退出码 0；tsc 保持 5 条存量 | —（已完成） | 本上下文编辑与复跑记录 |
| B1-6 | verified | 核验通过：3 文件哈希逐字一致（配置 `11596aba…`、package.json `9cccdd32…`、settingsStore `9b09d7eb…`）；注释 diff 恰 1 行；`check:electron`=0 且 9 文件全覆盖；**负对照成立**（worker 与 PM 双份独立探针注入错误均被抓出）；`npm run build` 退出码 0（本上下文独立复跑——X1 后构建命令恢复绿）；98/98。**基线 0 采纳**（≈77 为解析未配齐噪音，见 §5） | —（已完成） | reportId b1-6-appshell-attempt1；本上下文复验 |
| B1-V | verified | 独立验证通过：两连跑 98/98（无 flake）、tsc=0、build=0、check:electron=0；不变式零命中；逐项零引用全部通过（CodeAtlas 仅 R2 白名单项；tsbuildinfo/theme 常量属已知项）；冻结哈希 10 项吻合；冒烟通过（health=`tracecrew`、5173=200、三端点 404、只杀自有进程）；**全程零写入**。本上下文抽查复跑一致。观察：§5 缺完整冻结哈希清单（→B1-D 补正） | —（已完成） | reportId b1v-project-test-attempt1；本上下文抽查记录 |
| B1-D | verified | 已完成：R19（类型门政策与基线 0）与 R1/R10/T10 更新；三处口径修正（方案 N1、提案 §2-C6、本记录 §5）；§5 补完整 64 位冻结哈希清单与 X2 增量；Z4/Z5 归目；方案置 designed、提案置 verified；memo/feature-map 更新 | —（已完成） | 本上下文编辑记录 |
| X1-A | verified | 核验通过：哈希逐字一致；4 处最小编辑（import 移除 / `sequenceGraph: null` 含运行时等价论证 / actionColor 三处同删）；tsc 4→1（仅暂停项）；`npm test` 98/98；MapperView 零改动 | —（已完成） | reportId x1a-agent-pipeline-attempt1；本上下文复验 |
| X1-C | verified | 核验通过：恰 1 行删除、哈希一致、tsc 5→4、`npm test` 98/98 | —（已完成） | reportId x1c-appshell-attempt1；本上下文复验 |
| X1-B | verified | 客户批准方案 (a) 已落地（与 B1-3 同一 worker）：`Props.phase` 恰 1 行变更、哈希 `0b843f1f…` 一致；tsc 由 1→**0** | —（已完成） | reportId b1-3-graph-view-attempt1；本上下文复验 |
| R1-N | verified | 核验通过：`git diff` 恰 +1 行（第 24 行 `.tracecrew.lock`）；sha256 `a80238f1…` 一致；`git check-ignore -v` 命中 `.gitignore:24`；`.codeatlas` 三条原样；唯一 delta = 该文件 | —（已完成） | reportId r1n-appshell-attempt1；本上下文复验 |
| X2-A | verified | 核验通过：3 文件哈希与合并复验逐字一致（`55129dc4…`/`7fddf5ac…`/`15b942d1…`）；`main.ts` 恰 -1 行、「非漏接」判定成立（`git log -S` 证明历史从未调用；仅移除不代接线）；tsconfig 双旗标生效（`--showConfig`）；worker 负对照成立 | —（已完成） | reportId x2a-appshell-attempt1；本上下文合并复验 |
| X2-B | verified | 核验通过：diff 恰 -2 行（哈希 `864b1d44…`、`reviewAgentMsg` 引用清零）；可达性论证（成功分支 ops≥1 ⇒ 死存储）成立；带旗标针对性检查与合并四门槛均绿 | —（已完成） | reportId x2b-agent-pipeline-attempt1；本上下文合并复验 |

## 4. 事件历史（按发生顺序追加）

| seq | 时间（本地） | 事件 kind | 节点 | 摘要 |
| --- | --- | --- | --- | --- |
| 1 | 2026-10-16 ~14:00 | assigned | 全部 | 批 1 立项记录建立；合并提案 `../change/2026-10-16_change_batch1-cleanup-hardening.md` 呈报中；节点表就绪，实施待客户批准 |
| 2 | 2026-10-16 ~14:30 | approved | 全部 | 客户批准 C1–C8 全案 + D5/D6/D7 并入 + O-b1 + D5 存储层保留（经协调者转呈）；治理增补完成（app-shell Section 1 增 `frontend/tsconfig.electron.json`，changelog 已记） |
| 3 | 2026-10-16 ~14:32 | assigned | B1-1、B1-4 | 并行派发（写集不相交）；B1-2/B1-3 待 B1-1；B1-6 待 B1-1；B1-5 待 B1-4 |
| 4 | 2026-10-16 ~14:50 | implementation-reported | B1-4 | worker 报告经协调者转交（reportId b1-4-agent-pipeline-attempt1）：3 文件；`remap` 前端 ts/tsx 零命中；tsc 与纯净 HEAD 逐字一致（5 条存量、新增=0）；`npm test` 95/95 |
| 5 | 2026-10-16 ~15:00 | verification-passed | B1-4 | 核验：哈希逐字一致；diff 逐 hunk 审阅通过（语义等价/零行为变化）。**裁定**：验收口径修正为「新增类型错误=0」（基线 5 条为 HEAD 存量，M3 亦已独立观察）；5 条存量错误（**阻断 `npm run build`**）记入 X1 待呈客户；观察项 Z1/Z2 归档（见 §6） |
| 6 | 2026-10-16 ~15:05 | verification-passed | B1-5 | 本上下文执行并核验（C2 + remap 键删除 + O-b1）：4 语言包 150 键对称、pipelineFlow 含 Architect、remapping 清零；`npm test`=98/98 退出码 0；tsc 保持 5 条存量 |
| 7 | 2026-10-16 ~15:30 | approved | X1 | 客户批准 X1（「把那 5 条类型错误修掉吧」；纯类型清理可直接实施；涉及行为/语义或暴露真实问题则暂停回报） |
| 8 | 2026-10-16 ~15:32 | assigned | X1-A、X1-C；X1-B 暂停 | X1-A（3 条）与 X1-C（1 条）并行派发；**第 3 条（App TS2322 phase 联合）暂停**——根因：`PipelineState.phase`（6 值含 'clarifying'）直传 `MapperView` 的 `phase` prop（5 值缺 'clarifying'）；运行时 'clarifying' 已实际流入并落空态默认分支（无报错）。修法选项：**(a) 推荐** `MapperView` 的 `Props.phase` 联合增 `'clarifying'`（类型如实化、零行为变化；落点 graph-view，需客户批准）；(b) call-site 映射（引入语义映射+三元，随 phase 增长需维护）；(c) 调整 PipelineState 语义（改动面大）。待客户决定 |
| 9 | 2026-10-16 ~15:40 | verification-passed | X1-C | 核验：恰 1 行删除、哈希 `47b650cc…` 一致；tsc 5→4；`npm test` 98/98。X1-C verified |
| 10 | 2026-10-16 ~15:42 | verification-passed | X1-A | 核验：哈希 `e1a71740…`/`9c7ebf86…` 一致；4 处最小编辑（含 TS2345 运行时等价论证）；tsc 4→1（仅 TS2322 暂停项）；98/98；MapperView 零改动。X1-A verified |
| 11 | 2026-10-16 ~15:45 | verification-passed | B1-1 | 核验：6 文件 diff 逐项吻合；C8 attempt1 失败为宿主钥匙串签名环境问题（worker 已隔离证明、与本项目代码无关）、attempt2 退出码 0 且产物齐全——本上下文复验 `codesign --verify --deep --strict`=0、dmg/zip/app 在册 → **C8 通过**；C1/C3 装配冒烟（health=200 且 service=`tracecrew`、三路由 404、5173=200）；98/98。B1-1 verified；残留裁定见 §6-R1–R4 |
| 12 | 2026-10-16 ~15:48 | assigned | B1-2、B1-3+X1-B、B1-6 | 客户批准 X1 方案 (a)；三节点并行派发（写集不相交）；B1-6 含 settingsStore 注释 nano 项 |
| 13 | 2026-10-16 ~16:00 | approved | R1-N | R1 治理处置完成（`.gitignore` 列入 app-shell Section 1；boundary+changelog 已记）；R1-N 派发：补 `.tracecrew.lock` 忽略行（`.codeatlas` 三条与数据不动） |
| 14 | 2026-10-16 ~16:10 | verification-passed | R1-N | 核验：+1 行（第 24 行）、哈希 `a80238f1…` 一致、`check-ignore` 命中、`.codeatlas` 原样、唯一 delta=该文件。R1-N verified；nano 项已登记入 B1-V 复查清单 |
| 15 | 2026-10-16 ~16:25 | verification-passed | B1-2 | 核验：删除 3 文件（哈希在案）、db.ts −89 行其余导出逐项复核、fileManager C7 输出错误（上提 `logFile` 为纯路径、不抛出、行为不变）；grep 零残留；98/98；tsc=0；check:electron=0。**口径澄清（Z3）**：C7 验收「空 catch」狭义=体为空/仅注释（本批枚举 6+1 处已全部处置）；其余 `return 默认值` 类归档为 N2 后续。B1-2 verified |
| 16 | 2026-10-16 ~16:30 | verification-passed | B1-3 + X1-B | 核验：topology 已删（routes/ 仅余 agent.ts）、MapperView 恰 1 行（`0b843f1f…`）；**tsc=0 退出码 0（5→0）**；98/98。观察项 A → H1 归档。B1-3/X1-B verified |
| 17 | 2026-10-16 ~16:45 | verification-passed | B1-6 | 核验：哈希逐字一致；`check:electron`=0/9 文件；**双份负对照成立**；`npm run build`=0（本上下文复跑）；98/98。**基线 0 采纳**（worker 归因链：首跑 53（含在删 4 文件 29 条）→对照 A 24→@types 优先 0；本 PM 早期 ≈77 为 ad-hoc 旗标缺位噪音——记录 §5 并交 B1-D 修正三处文档）。X2 小项记录（§6） |
| 18 | 2026-10-16 ~16:50 | assigned | B1-V | 全部实施节点 verified、无活跃写者 → **冻结候选**；派发 project-test 独立验证（回归+门槛+逐项零引用+冒烟+404 复核） |
| 19 | 2026-10-16 ~17:00 | approved | X2-A、X2-B | 客户批准 X2（3 处 unused 清理 + 两旗标，门达全同标准）；**排期（客户/治理确认）**：B1-V 冻结验证先行、其报告核验后再派发；X2 落地后对涉及 4 文件针对性复验（check:electron=0 含新旗标 / tsc=0 / build=0 / 98/98 / 无行为变化）并按不变式 #6 刷新受影响证据 |
| 20 | 2026-10-16 ~17:15 | verification-passed | B1-V；X2-A/B 派发 | B1-V 核验通过（抽查复跑：98/98、tsc=0、check=0、零命中、27 files 104+/484− 与报告吻合、零写入确认）；X2-A、X2-B 解除阻塞并派发（并行；X2-A 的旗标启用与 X2-B 的 agent.ts 清理存在**瞬态交叉**——check:electron 在两者未齐时可能单报 `agent.ts:1549`，最终 0 以 PM 合并复验为准） |
| 21 | 2026-10-16 ~17:35 | verification-passed | X2-A、X2-B | 核验：X2-B diff 恰 -2 行（`864b1d44…`、引用清零、可达性论证成立）；X2-A 三哈希与合并复验逐字一致（`55129dc4…`/`7fddf5ac…`/`15b942d1…`）、双旗标生效；**合并四门槛：check:electron=0、tsc=0、build=0、test=0（98/98）**——类型门达与前端全同标准且基线 0；双负对照（worker+PM）成立。X2-A/X2-B verified；观察 (i)(ii) 归目 Z4/Z5（§6） |
| 22 | 2026-10-16 ~17:50 | completed | 全部 | **批 1 任务闭环**：B1-1…B1-6、B1-V、X1-A/C/B、X2-A/B、R1-N、B1-D 全部 verified；98/98、tsc=0、build=0、check:electron=0、冒烟与 404 复核通过；规则 R19 与三处口径已修正、§5 哈希清单补全；H1/Z1–Z5 观察项全部归目；**未提交 git（待客户决定）** |
| 23 | 2026-10-16 ~18:00 | noted | 收口核对 | 工作区核对发现客户侧已有两次提交：`38a57c0`（修复链：测试迁移 + 两处缺陷，43→95/95）与 `9980fb1`（治理目录纳入）；**批 1 变更仍在工作区未提交**（vs HEAD：30 files、131+/497−、含 4 删除；另有 5 个未跟踪项：`frontend/tsconfig.electron.json`、`frontend/test/project-management/`、`角色卡/app-shell/changelog.md`、`docs/change/`、`docs/scheduling/architecture-batch1.md`）——提交/发布待客户决定（记录役未自行提交任何内容） |
| 24 | 2026-10-16 ~18:20 | completed | 收口 | **H1 闭环**（治理扩充 `.gitignore` 用途 + `*.tsbuildinfo` 忽略 + 移出跟踪；`dd7b395` 已推送）；git 全景核对：`38a57c0`/`9980fb1`/`beab2b8`（批 1 应用变更）/`8356a87`（治理文档更新）/`dd7b395` 五提交覆盖全部交付；**工作区干净（0 变更）**——「提交/发布」项就此闭合 |

## 7. 收口

批 1（architecture-batch1）于 2026-10-16 闭环：全部必需节点与附属小项 verified；候选物双版本可追溯（B1-V 冻结版 + X2 增量）；门槛全绿（98/98、tsc=0、build=0、check:electron=0）。**提交状态（客户侧，均已推送 master）：`38a57c0` 修复链、`9980fb1` 治理目录、`beab2b8` 批 1 应用变更、`8356a87` 治理文档更新、`dd7b395` H1；工作区干净。**后续：发布与批 2/3 立项、Z1–Z5 观察项待客户决定。（后续进展 2026-10-16：批 2 已立项并闭环——D2/D3/N2 前端/O-b1、D1 关闭；见 [architecture-batch2.md](architecture-batch2.md)；批 3 仍待客户立项。）

## 5. 验收口径（来自提案）

- 批末 B1-V 在合并候选上：`npm test` 全绿（基线 95 例 + O-b1 3 例 = 98，本批不删既有测试；如有变化须逐条说明）、启动冒烟通过、逐项 grep 零引用（C1/C3/C4/C5/C7）、不变式 #7 复查。
- C6 验收：`npm run check:electron` 可运行且输出无真缺陷类报错（基线 ≈77，ratchet）；C8 验收：一次完整打包实测记录（通过或失败均如实）。
- **口径修正（2026-10-16，B1-4 核验裁定）**：「`npx tsc --noEmit` 退出码 0」在 HEAD 不可达（5 条存量错误），B1-4 的等效门槛为「**新增类型错误 = 0**」（以纯净 HEAD 逐字对照为证）；批内其它涉及前端 tsc 的节点同此口径。**后续更新**：X1 系列已把 5 条清为 0，该口径成为历史；现主配置 tsc = 0。
- **基线数字（2026-10-16，B1-6 核验采纳）**：`npm run check:electron` 的 ratchet 基线 = **0**（9 文件全覆盖；worker 与 PM 双份负对照均证实检查器有效）。早期「≈77」为模块解析未配齐时的 ad-hoc 噪音快照（`esModuleInterop`/`paths` 缺位引发的隐式 any 级联），不构成真实债；**B1-D 需同步修正三处表述**：《项目架构升级方案》N1、《批 1 提案》§2-C6、本记录相应文字。配置维护注意：`paths` 的 `@types` 优先序不可颠倒（颠倒即复现约 24 条噪音）。
- **B1-V 冻结版完整哈希清单（64 位；2026-10-16，B1-V 后、X2 前）**：fileManager.ts `6300126da142e3165ae65497164207297f6a2ab59ca5bfa7578f0d3ae1d83de3`；db.ts `ee77245d12463ee883b9519f2fca694d3cbff8c4dedeb3259ad418509406923d`；settingsStore.ts `9b09d7eb48aa78a4e6b2a3338150d861625d75cadbae496523297a296d27951d`；package.json `9cccdd328418c28ecaec648d86180258fe3879557a3f655307a49fe22879077d`；tsconfig.electron.json `11596aba94e7f32a520cfc92e7e061c025c9f77401748175bca0fa7a96e53e13`；App.tsx `e1a71740a5e7fe7e116088d0fce28a1973304b67891c361876af463aa6714534`；ActionPanel.tsx `9c7ebf865a6e3a4fc13f92ce8b8ff45e461e97c6ac0ef43dd82830b44abcbd8f`；MapperView.tsx `0b843f1fcab4badde98d719b7b5c43aeb5453eeadcc5f7499798cb0589369036`；RightPanel.tsx `47b650ccc983f7de219fd9ec8fac27d711dce506fc1875f90ab9eca3e4cb8ead`；.gitignore `a80238f1f5e8549b415d2945aaea9393f6fb465c254878edaee9a2b0e19e39a2`。
- **X2 增量（B1-V 之后；按不变式 #6 刷新受影响证据）**：`main.ts` `55129dc421852944153a642a075da15495720ba72fae20896b24849feb6c490b`；`server/index.ts` `7fddf5acdb633f4b79f5567304e0f3fbf7fd1f95f0f1fd4c2a386b5e4b16c224`；`tsconfig.electron.json` `15b942d11df3d64b455054507323bd9826cb0e7ccbd20b77b30ca5cd17cb470e`；`agent.ts` `864b1d44c3f6d70d6ccdf747a0250fae679768c2c3a66231b99d4cf6d746956f`。刷新方式：X2 合并复验四门槛全绿（事件 seq 21）；**B1-V 的结论对应上述冻结版、X2 为其后经目标复验的增量**（两个版本在记录中均可追溯）。

## 6. 小项裁定与观察项

- **X1（已决 → 修复中）**：5 条 HEAD 存量类型错误（曾阻断 `npm run build`）。客户批准修复；X1-A（3 条）与 X1-C（1 条）已 verified（tsc 5→1）；第 3 条经客户批准方案 (a)，由 X1-B（与 B1-3 合并派发，graph-view）落地 → 目标 tsc 1→0，纳入 B1-V。
- **R1（需治理）**：`.gitignore` 锁名滞后——C1 已把锁文件改名 `.tracecrew.lock`，但 `.gitignore` 仍只忽略 `.codeatlas*`（新锁名未忽略，用户跑 `start.sh` 后会出现未跟踪锁文件）。`.gitignore` 不在任何角色 Section 1 → **请治理分配/处理**（增补 `.tracecrew.lock`；旧 `.codeatlas.lock` 条目保留无害）。
- **R2（裁定保留）**：`electron/fileManager.ts:35` 的 `'.codeatlas'` 忽略项——保留（目标项目内遗留数据目录继续被忽略，与「数据不动」口径一致）。
- **R3（裁定执行）**：`electron/settingsStore.ts:6` 注释含旧名 → 并入 B1-6 的 nano 项（注释级，属 D8 无争议命名清理）。
- **R4（保留）**：角色卡与历史文档中的 CodeAtlas 引用 → 历史记录，保留。
- **X2（待呈客户）**：启用与前端同标准的 `noUnusedLocals`/`noUnusedParameters` 后，electron/ 暴露 **3 处 TS6133**：`main.ts:20`（`closeDatabase` 未用 import）、`server/index.ts:6`（`fileURLToPath` 未用 import）、`services/agent.ts:1549`（`reviewAgentMsg` 赋值未用）。与 X1 同性质（unused 类小清理；涉及 app-shell + agent-pipeline）；**建议照 X1 先例批准修复并把两旗标加入 electron 配置**（门达到与前端全同标准）；是否立项请客户定。
- **观察项 Z3（口径澄清）**：C7 批 1 验收的「空 catch」狭义指**体为空或仅有注释**的静默点（本批枚举：`agent.ts` 6 处 + `fileManager:574`，均已处置）。`fileManager` 其余 `catch { return 默认值 }`（L67/88/131/392/509/517/596 附近）与 `db.ts parseJsonField` 不在本批范围——其中 `readFile` 经返回值 `error` 字段向上报告（非静默）、`killShell` 为动作兜底，其余属「设计内默认值兜底」；归档为 N2 后续批次候选（B1-V 按此口径复核，不记为失败）。
- **观察项 Z4（X2-A 上报）**：`main.ts` 的 `closeDatabase` import 由 rebrand 提交 `8d64343` 引入（message 自称 “for proper cleanup”，但 `git log -S` 证明**该调用从未落地**）——X2 仅移除、不代接线。如未来要做「退出前显式关闭 DB」属新增小项（待客户定；当前 better-sqlite3 WAL 随进程退出由 OS 释放，无可见问题）。
- **观察项 Z5（批 1 可观察后果）**：`db.ts` 在 electron/ 生产侧现已无导入者（仅 `db.test.ts` 完整覆盖；features/change_queue 存储层按客户 D5 裁定保留）。后续批次若决定彻底移除需另案（含约 15 条测试的处置）。
- **H1（已闭环 2026-10-16）**：`frontend/tsconfig.tsbuildinfo` 已由客户指令处置——治理侧扩充 `.gitignore` 条目用途（锁文件与生成物构建缓存）、追加第 25 行 `*.tsbuildinfo`、`git rm --cached` 移出跟踪（本地文件保留）；提交 `dd7b395` 已推送 master。复核：`git check-ignore -v frontend/tsconfig.tsbuildinfo` 命中 `.gitignore:25`。另注：今日会话环境曾声明「非 git 仓库」，实测 git 正常——以实测为准。
- **观察项 Z1**：`agent.ts` 764/781 两处非空 catch（返回默认值、无说明注释）；`App.tsx` 149/155/161/293/295 等前端静默 catch——候选并入后续批次的 N2 前端部分，本批未动。
- **观察项 Z2**：`graph.analyzing` 文案与 MapCanvas 阶段指示器在 planning 阶段统一显示 “Planner”，而该阶段也可能由 Architect 在跑（UI 细节，graph-view 范围）；本批未动，候选后续。
