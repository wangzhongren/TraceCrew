---
id: design-architecture-upgrade-plan
type: design
title: 项目架构升级方案（存量偏差处置与系统性隐患治理）
created: "2026-10-16"
updated: "2026-10-16"
timezone: Asia/Shanghai
status: designed
related: [fix-test-suite-red, fix-search-in-files-empty]
events:
  - date: "2026-10-16"
    kind: created
    summary: 基于 architecture.md §8 的 10 条偏差与本次修复暴露的两类系统隐患（electron 类型门缺口、静默 catch），提出分批升级候选方案，待客户评审
  - date: "2026-10-16"
    kind: revised
    summary: 按 M8 复核修正 N1 试算口径（现行 77 项实测；早期「81」为中途采样）
  - date: "2026-10-16"
    kind: decision
    summary: 客户决策：批 1 立项（D8/D10/N1/N2/N5）；D5→清理、D6→删除、D7→清理；N1 用 ratchet；.codeatlas 数据默认不动；N5/D8 先实测打包。批 1 合并提案已呈报
  - date: "2026-10-16"
    kind: verified
    summary: 批 1 实施完成并通过独立验证（B1-1…B1-6、B1-V 与 X1/X2/R1-N 全 verified；98/98、tsc=0、build=0、check:electron=0、冒烟通过）；N1 基线口径按实测修正为 0（双负对照）
  - date: "2026-10-16"
    kind: decision
    summary: 客户随批 2 批准确认：D1 关闭（薄路由样板对象已不存在；碰触式收口约定保留于 R11 语境）；E2E 复跑默认不跑；O-b1 采纳
  - date: "2026-10-16"
    kind: verified
    summary: 批 2 实施完成并通过独立验证（D2 图谱类型独立、D3 App 拆分、N2 前端全量、O-b1；119/119、tsc=0、build=0、check:electron=0、冒烟通过；B2-V 独立验证 + B2-F1 一行注释增量最小复验）；记录 ../scheduling/architecture-batch2.md 收口
---

# 项目架构升级方案（候选设计）

> 面向客户决策的设计文档。**批 1、批 2 均已实施并独立验证（2026-10-16）**；批 3 仍为候选，未经批准不实施。每条目给出「保持现状 / 升级 / 待客户定」的评估与推荐；批准某批后才按各角色提案流程逐项立项（本方案批准 ≠ 具体实施授权）。
> 依据：[../architecture.md](../architecture.md) 第 8 节（2026-10-16 版，10 条存量偏差）、本次测试红灯修复任务的实测发现、[../project-rules.md](../project-rules.md) 已确认事实。
> 量级口径：**S** = 同批内小改（单文件/少数文件）；**M** = 中等重构（多文件 + 测试）；**L** = 核心结构变动（跨角色 + 高回归面）；**待评估** = 需先做专项探测。

## 1. 一个具体场景：为什么现在值得做这件事

把 `npm test` 从「43 例红」修到「94 例全绿」的过程中，暴露了两个**结构性原因**，而不是仅仅几个坏用例：

1. 一个「重名遮蔽」缺陷（`fileManager.ts` 里本地的 `readFile` 把 `fs/promises` 的导入遮蔽了）让**文件搜索功能整体失效**了很久，没有任何机制在提交前拦住它——因为 `electron/` 目录**不在任何类型检查范围内**，构建链只转译不检查。
2. 同一处还叠加了第二个独立错误（`agent.ts` 把搜索响应对象当数组用），同样是**类型检查一眼可发现**的问题；而兜底的静默 `catch` 把运行期错误吞掉，让排查只能靠人肉。

结论：项目从 CodeAtlas 单 Agent 演进成 TraceCrew 多 Agent 流水线的过程中，快速迭代留下了两类债——**结构债**（§8 的 10 条）与**防错债**（类型门/错误可见性缺口）。本方案给两类债一个可分批、可决策的处置计划。

**完成后应该看到什么**：① 新功能/新角色接入不再需要绕开历史结构；② 这类缺陷在提交前被类型检查或测试拦住；③ 遗留命名与死代码清完，读代码不再踩坑。
**非目标**：不新增功能、不改 UI 设计、不做性能优化、不迁移技术栈。

## 2. 逐条评估：`architecture.md` §8 的 10 条偏差

### D1 Express 路由直连 services（跨过 Pipeline 层）

- **现状**：`routes/agent.ts` 直接调用 `agentService` 各方法；`routes/changes.ts`、`routes/features.ts` 直接导入 `services/db`；项目无 `pipelines/` 目录。
- **收益（若升级）**：与已验收的工程规则一致；未来在「路由 → 服务」之间要加编排（重试/审计/批量）时有落点。
- **代价与风险**：这些路由是 SSE 核心路径（对话/动作流），搬移要动流式行为；而当前路由都很薄，收益兑现慢、回归面大。**中-高成本 × 低近期收益**。
- **推荐**：**保持现状（默认），采用「碰到再收口」**——新功能扩展这些路由时顺带引入最薄的 pipeline 模块（符合 R11「新代码不扩散新偏差」）。若客户想要一次性收口：建议只先做 `routes/changes.ts` 这类薄路由样板。量级：S（样板）/ M（全量）。**类别：可选**。
- **归属**：agent-pipeline（agent 路由）、project-data（features/changes 路由）。
- **客户已定（2026-10-16，随批 2 批准确认）：关闭（不再适用）**——批 1 已删除 `routes/features.ts`、`routes/changes.ts`、`routes/topology.ts`，在用路由仅剩 `routes/agent.ts`；「先做一条薄路由样板」的样板对象已不存在（批 2 提案 §5）。保留约定：新代码碰触路由时顺带最薄收口（R11 语境）；未来若新增路由再评估。量级：—。**类别：已关闭**。

### D2 组件从 MapCanvas 导入图谱类型

- **现状**：6 个文件 `import type { … } from './MapCanvas'`（App、ChatPanel、ActionDialog、ActionPanel、RightPanel、MapperView）。
- **收益（升级）**：类型（模型）与渲染组件解耦；graph-view 改渲染时不再牵动所有下游 import；「图谱类型」有独立、明确的归属位置。
- **代价与风险**：低。新建独立类型文件（建议 `frontend/src/types/graph.ts`）+ MapCanvas 重导出保持兼容 + 逐个文件改 import；需治理角色核定新文件归属（建议 graph-view）。回归：类型级改动，现有测试覆盖大部分消费方。
- **推荐**：**升级（低风险、边界更清晰）**。量级：**S**。**类别：推荐**。
- **归属**：graph-view（类型文件）+ 各消费文件属主各改各的 import。
- **已落地（批 2，2026-10-16 验证）**：`types/graph.ts` 独立主场（含 `GraphNode`/`GraphEdge`/`CallGraph`/`ContextMenuAction`）+ MapCanvas 重导出兼容；6 处消费迁移，类型导入 grep 收口零残留。量级：**S（实际）**。**类别：已完成**。

### D3 App.tsx 同时承担组合根与流水线编排

- **现状**：742 行；既组合页面布局，又做自动执行编排（拓扑排序、依赖检查、逐节点 SSE 调用、`STATE.json` 持久化、执行记录）。
- **收益（升级）**：把编排抽为独立模块/hook（如 `useAutoExec`），可单测——O1 的抽取经验已证明这条路可行；App 回归组合根职责，变薄。
- **代价与风险**：中。一键执行是核心交互，行为不变性靠回归保障；抽出的新文件路径需治理授权。
- **推荐**：**升级（中优先）**。量级：**M**。**类别：推荐**。
- **归属**：agent-pipeline（App.tsx 现归其 Section 1）；新模块路径需治理增补。
- **已落地（批 2，2026-10-16 验证）**：`hooks/useAutoExec.ts`（hook + 可测纯函数）+ App 瘦身 **751→493 行**（B2-F1 后 494）；runSingleAction/handleStopAutoExec 迁出块逐字节等、其余块仅声明内增量（块级 diff 复验）；O-b1 纯函数单测 5 例。量级：**M（实际）**。**类别：已完成**。

### D4 fileManager.ts 多重职责与跨层直引

- **现状**：约 595 行，一个文件承载：fs 读写/行编辑、搜索、备份/回收站、Shell runner、任务日志；被 `main.ts`（IPC）与 `services/agent.ts`（工具执行）直接 import；无分层结构。
- **收益（升级）**：按职责拆成若干模块（编辑/搜索/备份/Shell/日志）后，各块可独立测试与演进；符合相邻层规则。
- **代价与风险**：**这是全项目最硬的承重墙之一**——IPC、Agent 工具、三个测试文件都挂在它的导出名上；拆分需要长期保持导出兼容（薄 facade），高回归面。**高成本 × 中收益**。
- **推荐**：**保持现状（默认）；若升级，作为大件单独立项**（先补测试再拆，且一次只拆一块）。量级：**L**。**类别：可选**。
- **归属**：project-data。

### D5 features 路由占位（本次新增实测证据）

- **现状**：`routes/features.ts` 多端点为 “Not yet migrated”；**实测 grep：前端对 `/api/v1/features`、`/api/v1/topology`、`/api/v1/changes` 的调用点为零**（`getUrl` 也无人调用）。
- **收益（清理）**：消除误导（读者/新角色会以为这些能力存在）；Express 表面缩小、维护面变小。风险：低（无消费者）；保留在 git 历史里随时可取回。
- **代价**：若产品 roadmap 里有「功能树分析 / 拓扑刷新 / 变更队列」计划，则删了要重写——所以先问 roadmap。
- **客户已定（2026-10-16）：清理**——删除无消费者的 `/features`、`/topology`、`/changes` 占位路由与 `getUrl`；**存储层 db 函数与表保留**（口径说明见批 1 提案 §2-C3）。量级：**S**。**类别：已决策（批 1 已实施并验证）**。

### D6 summarizer.ts 未接线

- **现状**：`SummarizerService`（队列 + 哈希去重 + LLM 摘要 → `file_summaries` 表）实现完整，但**全仓零引用**；配套的 `file_summaries` 表与读接口同样闲置。
- **收益（若接线）**：接通后读过的文件有摘要缓存，长会话的上下文成本/速度受益（这是它被写出来的原因）。
- **代价与风险**：接线触发点需设计（读文件后入队？）；**注意：每个文件一次 LLM 调用 = 真实 token 成本**，这是产品决策而非纯技术决策；且它需要能独立验证（LLM 相关测试用替身）。
- **客户已定（2026-10-16）：删除**——移除 summarizer 及其相关表/接口（减死代码；可从 git 历史找回）。量级：**S**。**类别：已决策（批 1 已实施并验证）**。

### D7 前端预留 remap 事件、后端未发

- **现状**：`App.tsx` / `ActionPanel.tsx` 处理 `remap_token` 与 `remap` 阶段；`electron/` 内无 “remap” 字样。
- **研判**：像是「改完代码后重绘图谱」的未完工功能。盲目删除有风险（可能是规划中能力）；保留有轻微误导成本。
- **客户已定（2026-10-16）：清理**——移除前端 `remap_token`/`remap` 处理代码与对应 i18n 键（`action.remapping` ×4 语言）。量级：**S**。**类别：已决策（批 1 已实施并验证）**。

### D8 CodeAtlas 遗留命名与无效打包引用

- **现状**：`start.sh` 横幅 “CodeAtlas”；健康检查返回 `service: 'code-atlas'`；仓库根有 `.codeatlas/`（含 4 组历史备份数据）与 `.codeatlas.lock`；`frontend/package.json` 的打包配置引用**不存在的** `../backend`（`files` 与 `extraResources`）。
- **收益（升级）**：用户/维护者不再看到两个名字；消除无效打包引用；**若 `extraResources` 的缺失目录会让 `npm run electron:build` 报错，那是发布阻塞缺陷，优先级更高**（本次**未验证**——本方案未执行打包）。
- **代价与风险**：低。注意：`service` 名是否有外部消费方需确认（`start.sh` 只检查 `status`）；`.codeatlas/` 目录内有历史备份，**处置（改名/删除）前需确认数据去留，不擅自动**。
- **已落地（批 1，2026-10-16 验证）**：命名清理与打包引用修复完成（health `service`=`tracecrew`、脚本横幅/锁名、`package.json` 去 `../backend` 与 extraResources）；`.codeatlas/` 数据按口径未动；`npm run electron:build` 实测通过（产物 + 签名校验）。量级：**S（实际）**。**类别：已完成**。**归属**：app-shell。

### D9 测试红灯（已闭环）

- **现状**：已闭环（2026-10-16）——M1–M8 全部 verified、M5 独立验证通过（95/95、启动冒烟、零 skip/only）。详见 [../fix/2026-10-16_fix_test-suite-red.md](../fix/2026-10-16_fix_test-suite-red.md) 与 [../fix/2026-10-16_fix_search-in-files-empty.md](../fix/2026-10-16_fix_search-in-files-empty.md)。
- **后续**：以 R9/R10 的常态规则维持（测试运行方式已迁移 Electron Node）。量级：—。**类别：已完成**。

### D10 i18n 文案与实现漂移

- **现状**：`chat.pipelineFlow` 仍写 “PM → Planner → Reviewer → Mapper”，实际流水线已含 Architect。
- **收益**：用户看到的说明与真实流水线一致（面向初学者的第一手信息）。
- **代价**：低（4 个语言包同步改；i18n 归项目管理）。可选加值：加一条 **i18n 一致性测试**（4 语言包键集合一致 + 关键键存在）到 `frontend/test/project-management/`，防止未来再漂移（S）。
- **已落地（批 1，2026-10-16 验证）**：4 语言包 `chat.pipelineFlow` / `graph.emptyAction` 修正 + `action.remapping` 键删除；O-b1 一致性测试（3 例）随批落地。量级：**S（实际）**。**类别：已完成**。**归属**：project-management。

## 3. 新增候选（§8 之外，本次修复任务暴露的系统性隐患）

### N1 electron/ 无类型检查（本次已探得基线）

- **现状（2026-10-16 批 1 实施后，配置口径实测）**：`npm run check:electron` → **基线 0 条错误**（worker 与项目管理各一轮**负对照**证实检查器有效）。此前的「81/77」为 ad-hoc 试算噪音快照（`esModuleInterop`/`paths`/`@types` 优先序缺位引发的隐式 any 级联与模块解析项），**不是真实债**；本类两条真缺陷（M7 重名遮蔽、M8 响应误用）已随修复链清除。归因链与证据见 [../scheduling/architecture-batch1.md](../scheduling/architecture-batch1.md) §5。
- **收益**：本次两个缺陷（重名遮蔽、响应对象误用）都属于「类型检查一眼可见」的问题；建门后新代码在提交前被拦住。
- **代价与风险**：①配置（独立 tsconfig + 模块解析映射 + 挂 `check` 脚本——新文件路径需治理为 app-shell 增补）；②清理 80 项非缺陷报错（多为补类型注解）；风险低（只加检查、不改行为）。
- **已落地（批 1，2026-10-16 验证）**：`frontend/tsconfig.electron.json`（全同标准）+ `check:electron` 脚本；基线 **0**、政策「保持 0」入 R19；双负对照证实有效。量级：**S（实际）**。**类别：已完成**。**归属**：app-shell（配置）+ 各文件属主（后续注解类维护）。

### N2 静默 catch 清扫（R12 的落地）

- **现状（实测）**：全仓约 88 处 `catch`（按行计），其中**约 30 处静默/仅注释**（本次被修掉的 `catch { /* skip unreadable */ }` 正是其一；另有 ChatPanel 9 处、App 5 处、`agent.ts` 6 处等）。其中一部分是「确实可忽略」（如 localStorage 不可用、DB 迁移的“列已存在”），**不能机械全改**。
- **收益**：运行期错误不再无声消失；符合 R12「每个 catch 必须输出错误」。
- **代价与风险**：逐处判断需要上下文；误改会产生噪音日志。中低。
- **已落地（批 1 + 批 2）**：`electron/` 第一批（批 1：`agent.ts` 6 处显式注释 + `fileManager:574` 输出错误；其余 `return 默认值` 类归目 Z3，见 [../scheduling/architecture-batch1.md](../scheduling/architecture-batch1.md) §6）；**前端全量（批 2，2026-10-16 独立验证）**：19 文件 34 处逐处判定（已输出 7 / 已注释 27 / 正则误报 1），白名单核验通过；批末边界项 1 处（App.tsx:348）以一行注释最小修复收口（B2-F1）。量级：**M（分批完成）**。**类别：已完成**（electron 余类按批 1 归目 Z3 观察）。**归属**：各文件属主。

### N3 端口硬编码三处（对应 R2/T7）

- **现状**：19850/5173 硬编码在三处（server/index.ts、vite.config.ts、preload.ts），互相靠注释指认。
- **研判**：三处都集中在装配层、改动率极低；集中成一个常量需要跨 bundle 的共享文件（边界成本大于收益）。
- **推荐**：**保持现状**（默认）。若未来需要「可配置端口」，再单独立项。量级：**S**。**类别：可选**。

### N4 前端 API 通道与 `getUrl` 收口

- **合并至 D5**（同一次清理决策）：`/features`、`/topology`、`/changes`、`getUrl()` 均无消费者。

### N5 构建/打包路径复核

- **现状**：`../backend` 无效引用（见 D8）；`npm run electron:build` **本次未实测**（是否成功未知）；`start.bat`（Windows）长期未验证。
- **已落地（批 1，2026-10-16 验证）**：`npm run electron:build` 实测**通过**（首跑因宿主钥匙串签名环境问题退出 1、修复引用后退出 0；产物 dmg/zip/app 齐全、`codesign --verify --deep --strict` 通过）；Windows 路径仍待评估。量级：**S（实际）/ 待评估（Windows）**。**类别：已完成（除 Windows）**。**归属**：app-shell。

## 4. 分批规划（建议）

| 批次 | 主题 | 条目 | 风险 | 前置 |
| --- | --- | --- | --- | --- |
| **批 1** | 卫生与防复发（**已实施并验证 2026-10-16**） | D8、D10、N1、N2 第一批、N5 + D5/D6/D7 清理（并入） | 低 | **闭环**（B1-1…B1-6、B1-V 独立验证通过；X1/X2/R1-N 附属项亦 verified；记录：[../scheduling/architecture-batch1.md](../scheduling/architecture-batch1.md)） |
| **批 2** | 解耦（**已实施并验证 2026-10-16**） | D2（图谱类型独立）、D3（App 拆分）、N2 前端全量、O-b1；D1 关闭（样板对象已不存在） | 中 | **闭环**（B2-1…B2-6、B2-V 独立验证 + B2-F1 增量最小复验全 verified；119/119、tsc=0、build=0、check:electron=0；记录：[../scheduling/architecture-batch2.md](../scheduling/architecture-batch2.md)） |
| **批 3** | 结构 | D4（fileManager 拆分，大件单独立项）、D1 全量（可选）、D5/D6/D7 客户定夺后的落地 | 高 | 批 2 完成；每项单独提案 |

每批验证方式：各条目自带单元/契约测试 → 批末 `npm test` 全绿 + 启动冒烟 + 受影响流程回归（**由固定测试角色在合并候选上独立执行**）；每项实施仍走「提案 → 客户批准 → 角色实施 → 独立验证」。

## 5. 必选 / 可选 / 待客户定（分层汇总）

| 类别 | 条目 | 说明 |
| --- | --- | --- |
| **批 1（已实施并验证 2026-10-16）** | D8、D10、N1、N2、N5 + D5、D6、D7 | **闭环**：98/98、tsc=0、build=0、check:electron=0、冒烟通过；提案 [../change/2026-10-16_change_batch1-cleanup-hardening.md](../change/2026-10-16_change_batch1-cleanup-hardening.md)、调度 [../scheduling/architecture-batch1.md](../scheduling/architecture-batch1.md)；`.codeatlas/` 数据按口径未动 |
| **已完成（批 2）** | D2、D3、N2 前端全量、O-b1 | 2026-10-16 闭环：119/119、tsc=0、build=0、check:electron=0、冒烟通过（[../scheduling/architecture-batch2.md](../scheduling/architecture-batch2.md)） |
| **可选**（保持现状也可接受） | D4（大件单独立项）、N3 | 收益真实但成本/风险比不占优 |
| **已关闭** | D1 | 2026-10-16 客户确认（薄路由样板对象已不存在；碰触式收口约定保留于 R11 语境） |
| **已完成** | D9 | 2026-10-16 闭环 |

## 6. 与当前修复任务、M5/M6 的先后关系

1. 当前修复链条（M1–M8 → M5）已闭环（95/95、冒烟通过，2026-10-16）。
2. **批 1 已实施并独立验证闭环**（B1-1…B1-6、B1-V 与 X1/X2/R1-N 附属项全 verified；98/98、tsc=0、build=0、check:electron=0；记录：[../scheduling/architecture-batch1.md](../scheduling/architecture-batch1.md)）。
3. N1 的「真缺陷」部分已随 M8 处置；批 1 内 N1 = 配置 + 脚本 + 政策（已落地并写入 R19）。
4. 本方案评审、批 1 与批 2 均已完成（客户 2026-10-16 决策 + 批准实施）；**批 3 与提交/发布待后续客户决定**。

## 7. 未决问题（请客户评审时一并考虑）

1. ~~三个产品问题~~ **已决（2026-10-16 客户）**：D5 无计划 → 清理；D6 → 删除（可从 git 历史找回）；D7 无计划 → 清理；三者**建议并入批 1**（见批 1 提案 §4，待批准时一并确认）。
2. **打包现状**：批 1 首项实测（N5/D8）；若报错按缺陷优先处理。
3. ~~类型门清理策略~~ **已定**：ratchet（只对新改文件要求零新增），随 N1 落地并写入 `project-rules.md`。
4. **批准方式**：批 1 已合并为一份实施提案呈报（一次批准）；后续批次待后。
5. **客户补充口径**：`.codeatlas/` 的 4 组历史备份**默认不动**（D8 只做无争议清理）。

## 附：证据与口径说明

- 现状描述基于 2026-10-16 代码与实测：§8 原文；本次新增实测——electron/ 严格试算 **77 项（66 TS7006 / 11 TS2307 / 0 真缺陷）**；catch 扫描（88 处，约 30 处静默）；`/features`、`/topology`、`/changes`、`getUrl` 前端零消费者（grep）；`backend/` 目录不存在；`.codeatlas/` 含 4 组历史备份。
- 本方案为候选设计；任何条目在获得批准前不实施、不改代码。相关记录：[../fix/2026-10-16_fix_test-suite-red.md](../fix/2026-10-16_fix_test-suite-red.md)、[../fix/2026-10-16_fix_search-in-files-empty.md](../fix/2026-10-16_fix_search-in-files-empty.md)、[../scheduling/test-suite-red-fix.md](../scheduling/test-suite-red-fix.md)。
