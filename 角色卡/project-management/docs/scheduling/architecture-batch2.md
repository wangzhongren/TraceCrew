# 调度记录 — architecture-batch2（架构升级批 2：图谱类型独立 + App 拆分 + N2 前端）

> 单写者：项目管理上下文（手工维护）。planRevision: 1
> 实施提案：[../change/2026-10-16_change_batch2-graph-types-app-split.md](../change/2026-10-16_change_batch2-graph-types-app-split.md)（**已批准；实施与独立验证闭环 2026-10-16**）
> 方案依据：[../design/2026-10-16_design_architecture-upgrade-plan.md](../design/2026-10-16_design_architecture-upgrade-plan.md)（§4 批 2 行）

## 1. 任务与授权

- **任务**：批 2 立项——D2（图谱类型独立）、D3（App 编排拆分）、N2 前端批次；附 D1 关闭建议、E2E 复跑评估（默认不跑）。
- **授权记录（2026-10-16，经协调者转呈的客户指令）**：客户原话「批 2 立项吧」；提案已呈报，客户确认全部推荐项（见 seq 2：批准 D2+D3+N2 前端+O-b1；**D1 关闭**；E2E 复跑默认不跑）。
- **治理前置（与 C6 同模式）**：`frontend/src/types/graph.ts`（属 **graph-view**）与 `frontend/src/hooks/useAutoExec.ts`（属 **agent-pipeline**）两条新路径需先增补入对应 Section 1，再派发实施。

## 2. 节点表

| 节点 | 角色 | 交付物 | 写入范围 | 前置 | 状态 |
| --- | --- | --- | --- | --- | --- |
| B2-1 | graph-view | 建 `types/graph.ts`；MapCanvas 改用并**重导出**；MapperView import 迁移 | `frontend/src/types/graph.ts`（新）、`frontend/src/components/MapCanvas.tsx`、`frontend/src/components/MapperView.tsx` | 治理增补（路径一，已完成） | **verified**（attempt 1；迁移逐字节一致复跑过） |
| B2-2 | agent-pipeline | D2 迁移（App/ChatPanel/ActionDialog/ActionPanel）+ N2（App/ChatPanel 注释处置） | `frontend/src/App.tsx`、`components/{ChatPanel,ActionDialog,ActionPanel}.tsx` | B2-1（已满足） | **verified**（attempt 1；哈希 `2ae06567…`/`67c81dde…`/`142adbc3…`/`68508058…`） |
| B2-3 | app-shell | D2 迁移（RightPanel）+ N2（SettingsPanel/TitleBar） | `frontend/src/components/{RightPanel,SettingsPanel,TitleBar}.tsx` | B2-1（已满足） | **verified**（attempt 1；哈希 `59578b0b…`/`3dd69059…`/`4dc6d217…`） |
| B2-4 | project-data | N2（CodeViewer：判定 + 一行说明注释） | `frontend/src/components/CodeViewer.tsx` | — | **verified**（attempt 1；哈希 `4338c593…`） |
| B2-5 | project-management | N2（i18n 两处显式注释） | `frontend/src/i18n/index.tsx` | — | **verified**（本上下文执行；哈希 `2e69d486…`） |
| B2-6 | agent-pipeline | D3：`hooks/useAutoExec.ts` + App 瘦身 + O-b1 纯函数单测 | `frontend/src/hooks/useAutoExec.ts`（新，治理增补）、`frontend/src/App.tsx`、`frontend/test/agent-pipeline/**` | 治理增补（路径二）+ B2-2（同写 App.tsx 串行） | **verified**（attempt 1；751→493 行，兼容 `4995dcb8…`） |
| B2-V | project-test | 批末独立验证（四门槛 + 冒烟 + D2 grep 收口 + N2 白名单核验 + B2-6 块级 diff 复验） | `frontend/test/project-test/**`（如需）、本角色 docs | B2-1…B2-6（已完成） | **verified**（attempt 1；本上下文核验通过：15/15 哈希逐字一致、D2 grep 收口复跑一致、blockdiff 原始输出逐项复核、冒烟证据复核、跑前/跑后 15/15 全同、抽查 tsc=0；边界命中 1〔App.tsx:348〕→ 裁定 (a)，见 seq 10） |
| B2-F1 | agent-pipeline | 最小修复：App.tsx:348 catch 补一行说明注释（裁定 (a)） | `frontend/src/App.tsx` | B2-V（已完成） | **verified**（attempt 1；diff 恰 1 行新增〔348a349〕、零删除；哈希 `af636fd3…` 与报告一致；493→494 行） |
| B2-D | project-management | 规则/文档收口（D1 关闭入方案、E 系列与批 2 记录） | 本角色 docs | B2-F1（已完成） | **verified**（本上下文执行；提案置 verified、设计文档 D1 关闭 + 批表闭环、收口节见 §5） |

**写集冲突**：B2-1 先于 B2-2/B2-3（类型文件须先存在）；B2-2 与 B2-6 同写 `App.tsx` → 串行；其余互不相交。
**E2E 复跑**：默认不跑（提案 §6 评估）；如客户指定则并入 B2-V。

## 3. 验收口径（来自提案 §9）

`npm test`（114 + O-b1 新增）全绿 → `tsc`=0 / `build`=0 / `check:electron`=0 → 启动冒烟 → project-test 独立验证（含 D2 类型导入 grep 收口、N2 白名单核验）→ GUI 目视清单交客户（D3 一键执行三处、D2 图谱渲染惯例）。

## 4. 事件历史

| seq | 时间 | 事件 kind | 节点 | 摘要 |
| --- | --- | --- | --- | --- |
| 1 | 2026-10-16 | assigned | 全部 | 客户「批 2 立项吧」；合并提案编制完成并呈报；节点表与治理前置（两条新路径）入档；实施待一次确认 |
| 2 | 2026-10-16 | approved | 全部 | 客户确认全部推荐项（① 批准 D2+D3+N2 前端+O-b1；② **D1 关闭**；③ **E2E 复跑默认不跑**）；治理增补完成（graph-view/agent-pipeline/project-data 三处 Section 1 同步 + 新建 changelog；MD/YAML 条目数一致性校验过）；B2-1/B2-4 派发，B2-5 本上下文执行 |
| 3 | 2026-10-16 | verification-passed | B2-5 | 本上下文执行并核验：i18n `index.tsx` 两处 catch（locale 检测 / 持久化）加显式注释、逻辑零变（diff 恰为注释展开）；哈希 `2e69d486…`；tsc=0、npm test 114/114、check:electron=0。B2-5 verified |
| 4 | 2026-10-16 | verification-passed | B2-4 | 核验通过：diff 恰 +1 行说明注释（错误已由错误态 UI 呈现）；哈希 `4338c593…` 与报告一致；全文件 catch 数 2（1 语句 + 1 高亮关键字，与报告说明一致）；tsc 复跑 0（含 B2-1 中途态）。B2-4 verified |
| 5 | 2026-10-16 | verification-passed | B2-1 | 核验通过：**逐字节迁移证明（本上下文独立复跑 `diff` 为空）**；MapCanvas 重导出在位、theme 导入收窄（noUnusedLocals 下必要、语义中性）；MapperView 拆分导入；哈希 `3b1fdaff…`/`9ca71b24…`/`88d5895c…` 与报告逐字一致；tsc=0、npm test 114/114、check:electron=0。B2-1 verified；**B2-2/B2-3 并行派发** |
| 6 | 2026-10-16 | verification-passed | B2-3 | 核验通过：RightPanel 迁移行 + SettingsPanel 3 处注释（88/116/136，含两处单行箭头 catch 展开为块的 AST 中性变更）+ TitleBar 注释；哈希 `59578b0b…`/`3dd69059…`/`4dc6d217…` 逐字一致；`MapCanvas` 于 RightPanel 归零；tsc 复跑 0（含 B2-2 中途态）。遗漏普查（三文件 catch 全量清点）采纳入档；证据时间窗已在 B2-V 复跑口径内。B2-3 verified |
| 7 | 2026-10-16 | verification-passed | B2-2 | 核验通过：diff 34+/12− 恰如报告（4 迁移行 + 16 处「预期可忽略：<理由>」注释、8 条 catch 重排 AST 中性）；四哈希逐字一致；只读依赖未动（MapCanvas `9ca71b24…`、graph.ts `3b1fdaff…`）；迁移 grep 零命中；**无 D3 预抽取**（handleAutoExec/topoSortNodes 原样）；发现并处置提案外一处（ChatPanel:448 的 ARCHITECTURE.md 旁路落盘注释）采纳入档。B2-2 verified；**B2-6（D3）派发** |
| 8 | 2026-10-16 | verification-passed | B2-6 | 核验通过：三哈希逐字一致（hook `4995dcb8…`、App `d01d0ab7…`、测试 `c3ea7bd0…`）；751→493 行；唯一性标记（alert 文案×2、`[autoExec result]`、stopRef 初值）hook=1/App=0；**runSingleAction 块本上下文独立复跑为 BYTE-EQUAL**（基线副本 vs 新 hook）；App 定义体残留 grep 零命中；接口微调（setStream/actionAbortRef 入参、setExecRecords 返回）为承载原闭包捕获、边界不变；tsc=0、npm test **119/119（7 文件）**、check:electron=0。B2-6 verified；**B2-V 批末独立验证派发** |
| 9 | 2026-10-16 | handover | 全部 | 前任项目管理上下文因累计上下文达模型上限（约 92 万 token）被 API 终止；**本上下文（新开）自记录接管**——seq 1–8 既定 verified 状态以记录为准（B2-1…B2-6 全部 verified；B2-V running、B2-D pending，均不变）。接管核验：B2-6 基线副本齐备（`/tmp/b2-6/`）；**B2-V 子代理独立存活性已核实**（其转录 15:16 仍在写入，正进行哈希取证，hook `4995dcb8…`/App `d01d0ab7…` 与 seq 8 记录一致）→ 无需重新派发。后续：等待 B2-V 报告经协调者转交 → 独立核验（四门槛/ grep 收口 / N2 白名单 / 冒烟 / B2-6 块级 diff 复验）→ B2-D 收口 → 最终报告 |
| 10 | 2026-10-16 | verification-passed | B2-V | B2-V 报告经协调者转交，**本上下文独立核验通过**：15/15 候选哈希逐字一致（含基线 `2ae06567…`）；D2 收口 grep 复跑一致（唯一命中 = MapperView 默认导入；graph.ts 四类型 L11/29/36/41 + 重导出行 MapCanvas:10 在册）；**blockdiff 原始输出逐项复核**（runSingleAction/handleStopAutoExec 逐字节等；topoSort 去缩进等；collect 仅 +return 一行；handleExecuteNode 恰 2 处、handleAutoExec 恰 3 处增量，全部对应已声明映射、无未声明增量）；冒烟证据复核（health=`tracecrew` 200、5173=200、自有 PGID、终止后端口释放）；跑前/跑后 15/15 哈希全同、验证过程零改动、git 未提交；四门槛日志复核 + 本上下文抽查复跑 tsc=0；catch 审计原始清单复核（34 处 = 已输出 7 / 已注释 26 / 正则误报 1 / 边界 1）。边界命中 **App.tsx:348**（handleActionConfirm 外层 catch，错误经 `setStream` 呈现在 UI）**裁定 (a)：补一行说明注释**——理由：N2 验收白名单（已输出/已注释）按字面收口、与 CodeViewer 先例一致、不事后放宽口径；成本 = 1 注释行 + 按不变式 #6 最小复验（diff=1 + 四门槛复跑）。**B2-F1 派发**（agent-pipeline 最小上下文） |
| 11 | 2026-10-16 | verification-passed | B2-F1 | B2-F1 完成并经本上下文独立复验：diff 恰 1 行新增（348a349、0 删除；快照 `/tmp/b2-f1/App.before-f1.tsx`）；哈希 `af636fd3…`；现场核对注释位于 catch 块首行、6 空格缩进；493→494 行。**最终候选四门槛复跑全绿**（本上下文）：npm test **119/119 ×2 无 flake**（7 文件）、tsc=0、build=0、check:electron=0；D2 收口 grep 复跑零残留；catch 白名单 34 处全清（边界项收口）。`d01d0ab7…`→`af636fd3…` 为 B2-V 冻结版后**唯一增量**（不变式 #6 最小复验完成）。B2-F1 verified；**B2-D 收口执行** |
| 12 | 2026-10-16 | closed | B2-D | B2-D 收口完成（本上下文执行）：批 2 提案置 **verified**（状态头/事件/未决项同步）；设计文档 **D1 关闭**入档 + 批 2 行闭环 + N2 前端全量更新；本记录收口节 §5（节点汇总、最终哈希、版本说明、未测项、工作树状态）；memo 更新。**批 2 全链闭环**（B2-1…B2-6、B2-V、B2-F1、B2-D 全 verified）。提交/发布待客户决定；最终报告经协调者转呈客户 |

## 5. 收口汇总（2026-10-16）

- **节点**：B2-1…B2-6、B2-V（批末独立验证）、B2-F1（最小修复增量）、B2-D（本收口）全部 **verified**；事件 seq 1–12 完整。
- **最终候选哈希**（B2-F1 后冻结；App 前缀）：App.tsx `af636fd3…`（493→494 行）；useAutoExec `4995dcb8…`；graph.ts `3b1fdaff…`；MapCanvas `9ca71b24…`；MapperView `88d5895c…`；ChatPanel `67c81dde…`；ActionDialog `142adbc3…`；ActionPanel `68508058…`；RightPanel `59578b0b…`；SettingsPanel `3dd69059…`；TitleBar `4dc6d217…`；CodeViewer `4338c593…`；i18n `2e69d486…`；autoExecPure.test `c3ea7bd0…`；基线 `/tmp/b2-6/App.original.tsx` `2ae06567…`。
- **门槛（B2-F1 后本上下文复跑）**：npm test **119/119 ×2 无 flake**（7 文件）、tsc=0、build=0、check:electron=0；D2 收口 grep 零残留（唯一命中 = MapperView 默认导入）；N2 白名单 34 处全清；冒烟（B2-V，冻结版）：health=`tracecrew` 200 / 5173=200 / 自有 PGID / 未触碰任何非自有进程。
- **版本说明（不变式 #6）**：B2-V 独立验证对应冻结版（App `d01d0ab7…`）；B2-F1 为其后唯一增量（+1 注释行、零逻辑），最小复验 = 本上下文 diff=1 + 四门槛复跑全绿；两个版本在记录中均可追溯。
- **未测项（如实）**：① **GUI 目视清单（交客户）**：D3 一键执行三处交互（单节点动作 / 一键执行 ≥2 节点图 / 停止按钮）、D2 图谱渲染惯例；② E2E 复跑：既定不跑（提案 §6 评估）；③ 格式遗留：无（提案状态、本记录头注等已随 B2-D 更新；build 日志既有 npm 告警噪音为非问题）。
- **工作树**：批 2 变更**未提交**（11 个修改应用文件 + 3 个新增【`hooks/useAutoExec.ts`、`types/graph.ts`、`autoExecPure.test.ts`】+ 三处治理 boundary/changelog + 本角色文档）；E 系列已提交（`da6ca81`/`ddc4e66`），H1 已提交（`5b24aed`）；提交/发布待客户决定（R14：验证不授权提交）。
- **提交更新（2026-10-16）**：客户指令后批 2 已提交并推送 —— `ef99479`（批 2 代码，14 文件 +558/−324）+ `b0ce23a`（治理记录与 UI 设计期产物，18 文件 +1877/−36）→ master（`ddc4e66..b0ce23a`）；工作区干净、远端同步。批 2 至此彻底关闭。
