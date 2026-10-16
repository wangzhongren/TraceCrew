---
id: design-positioning-alignment
type: design
title: 定位对齐方案：代码讲解/解释工具——移除「一键执行」链 + 单点动作收敛
created: "2026-10-16"
updated: "2026-10-16"
timezone: Asia/Shanghai
status: verified
related: [design-pm-dispatch-design-draw, design-dispatch-default-draw]
events:
  - date: "2026-10-16"
    kind: created
    summary: 客户两条口径（「这个修改代码可以去掉…」+「工具需要专精代码的讲解和解释，而不是去修改」）；完成两路全量勘察（一键执行链面 file:line 清单 + 五种单点动作写入性体检）→ 产出保留面/移除面完整对照清单，呈客户一次确认
  - date: "2026-10-16"
    kind: approved
    summary: 客户确认：① 清单整体（含依赖 badge 默认移除、四修改类动作摘除）；② 服务端底层写入执行器 A 案保留（界面零入口、底层留存）；③ explain 落盘/导出纳入本次
  - date: "2026-10-16"
    kind: implemented
    summary: 实施完成：K1（agent-pipeline：移除面 A 主体 + 动作收敛 explain 唯一 + 死组件清 + 测试删）+ K2/K2b（graph-view：MapperView 收窄与死 props 补删）+ K1b（注释）+ K4（i18n 统一清理：净删 40 枚孤儿键〔含子串误报修正 3 枚〕、补 3 缺失、新增 explainExported → **116 键/包四包一致**）+ K3（explain 落盘/导出 + 路径提示）。**联合四门槛全绿：npm test 119/119（新基线 6 文件）×2、tsc=0、build=0、check:electron=0**；移除面 grep 全 src 零命中。**LX 独立验证通过**（reportId b2lx-project-test-attempt1）。记录 ../scheduling/positioning-alignment.md；「可复验」= HMR 渲染层即时生效（本批无主进程改动）。未测项：客户 GUI 目视（清单已备）+ 实机 explain 端到端导出
---

# 定位对齐方案：代码讲解/解释工具（移除「一键执行」链 + 单点动作收敛）

> 客户口径：「这个修改代码可以去掉，完全没必要。这个也没办法干。」+「这个工具现在需要专精这个代码的讲解，和解释。而不是去修改。」
> 一句话：**移除全部"改代码"路径**（一键执行自动链 + 修复/重构/开发/测试四个单点动作），**保留并强化"讲解/解释"链路**（讲解、咨询、派发、出图、解释动作）。不动已提交历史（全程可回溯）。

## 1. 移除面 A：一键执行自动链（精确清单，file:line 勘察）

| # | 项 | 位置 | 处置 |
| --- | --- | --- | --- |
| A1 | `useAutoExec.ts` **整文件**（352 行：hook + `topoSortNodes`/`collectAffectedExistingIds`/`AutoExec*` 类型；即批 2/D3 抽出的编排） | `frontend/src/hooks/useAutoExec.ts` | 删除（历史提交保留） |
| A2 | hook 调用 + 7 项解构 + MapperView 7 个 autoExec props 传递 | `App.tsx:12,212-224,413-419` | 删；MapperView Props 收窄 7 项（含 KanbanBoard 内联类型） |
| A3 | execRecords 镜像 effect（右面板→卡片记录） | `App.tsx:35-48` | 删（**仅内存，STATE.json 无此字段——勘察证实，无磁盘兼容面**） |
| A4 | 一键执行按钮块（进度/停止/▶） | `MapperView.tsx:340-358`（`unfilteredPending` :114 一并） | 删 |
| A5 | liveOutput 区块 + 相关 import 收窄 | `MapperView.tsx:245-250`、:4 | 删 |
| A6 | execRecords 卡片记录展示 | `MapperView.tsx:259-289` 等 | 删（随 A3 去留；仅服务执行链展示） |
| A7 | **行为变化（请客户知悉）**：卡片动作按钮现经 `onExecuteNode`（hook）直执行；链移除后自动回落**既有 else 分支** → 改走右侧 ActionPanel 面板（选择→确认→执行） | `MapperView.tsx:230` | 零新代码；恰为"单点动作"意图 |
| A8 | 「⚠ 依赖未完成」badge（本地独立计算，但语义服务批量执行纪律） | `MapperView.tsx:124-129,204-208` | **默认移除**（减噪；可勾回） |
| A9 | 顺带：两枚死 props（MapperView 声明未用） | `App.tsx:408-409`、`MapperView.tsx:15,17` | 清 |
| A10 | 测试：`autoExecPure.test.ts` 5 例 | `frontend/test/agent-pipeline/` | 删除 → **新基线 119 例 / 6 文件** |
| A11 | 服务端 | — | **零改动**（无 autoExec 专属面；action 端点与单点共用） |
| A12 | i18n | — | **零链专属键**（按钮文案为硬编码中文）；4 语言包无删除 |
| A13 | 文档更新（现行描述）：README 使用示意、`docs/architecture.md`（6 处）、agent-pipeline role-card/boundary/changelog、graph-view boundary、`docs/scheduling/e2e-live-test.md:10`、memo | 各角色 | 更新；**历史调度/变更记录保留**（batch2、ui-redesign 等） |
| A14 | 治理面 | `agent-pipeline/boundary.md/.yaml` Section 1 | 移除 `useAutoExec.ts` 行（**交治理角色（ANS Governance）同步**） |

**保留（非链专属，勘察证实）**：「受影响」badge 与 affectedExistingIds（服务讲解）、classifyNode/activeNodeId（右面板联动）、`chat.stop` 键（他处共用）、App 的 graphRef/savedPlanRef/setStream/actionAbortRef（单点路径继续使用）。

## 2. 移除面 B：修改类单点动作（写入性体检结论）

| 动作 | 写码？ | 写入路径 | 建议 | 理由 |
| --- | --- | --- | --- | --- |
| explain 解释 | **否**（全仓唯一 `isReadOnly`，agent.ts:1438；仅流式 Markdown、不落盘） | — | **保留（定位核心）+ 强化** | 见 §3 |
| fix 修复 | 是（update 节点文件 + run-shell 编译检查） | node.file | **摘除** | 核心是改码 |
| refactor 重构 | 是（范围最大：node.file + 全部下游文件） | 多文件 | **摘除** | 核心是改码 |
| develop 开发 | 是（create/update；一键执行默认动作之一） | node.file/新文件 | **摘除** | 核心是写码 |
| test 测试 | **条件性=是**（可 create-file 测试文件 + run-shell 无命令白名单） | 测试文件 | **摘除** | 写测试文件即偏离"讲解"定位；"测试思路讲解"由 explain/对话承接 |

**动作级联清理**：`ACTION_CONFIGS` 收窄为 explain；`getActionsForNode` 门控简化；ActionPanel 按动作卡收窄；i18n `action.{fix,refactor,develop,test}*` 及 `*Scope/*Desc` 键 ×4 语言包清理（实际执行：净删 37 枚 + 子串误报修正后 3 枚，见调度记录 K4 行）。
**服务端提示词表口径修正（LX 观察项闭环）**：本文 §2 原列「`ACTION_SYSTEM_PROMPTS` 移除 4 项」**不执行**——按客户批准的 **A 案**，服务端含四动作提示词表**整体留存（界面不可达、可回溯）**，`electron/` 本批零改动。
**顺带存量处置（勘察发现）**：① `ActionDialog` 整组件为**死 UI**（零引用）→ 移除（含仅其引用的 5 个 `*Scope` 键）；② ActionPanel 引用 4 个 `*Context` 键在所有语言包缺失（界面显示原始键名）→ explain 路径缺失键补齐；③ ActionPanel 页脚「自动备份」提示对 explain 不匹配 → 随动作收敛移除。
**服务端底层（写 ops/自动备份/Reviewer 循环）**：动作摘除后**不可达**。**默认 A 案：保留不动**（最小改动、可回溯）；**可选 B 案：连底层一并彻底清理**（建议后续单独立项，避免本次动作面过大）。观察项备案：`run-shell` 现无命令白名单（fileManager.ts:472），未来若有任何写路径回归须先补白名单。

## 3. 保留面（强化）

- **理解链路全保留**：对话讲解、PM 咨询派发、Mapper 出图、**「讲完即画」**（已实施核验：check:electron=0、124/124；驱动回归本窗口执行中）——与自动链零交集（grep 证实）。
- **explain 动作强化**（建议纳入）：补「文档落盘/导出」（现仅流式展示、不保存——讲解产出可带走）。
- 图谱/CodeViewer/右面板/会话、PipelineState（graph/sequenceGraph/savedPlan）全保留。

## 4. STATE.json 兼容

`execRecords` **不落盘**（勘察证实：STATE.json 仅 graph/sequenceGraph/savedPlan/updatedAt）→ **无兼容任务**，仅删内存状态。

## 5. 验收

- **移除面零残留**：对清单项逐一 grep（`autoExec|execRecords|liveOutput|onExecuteNode|一键执行|fix|refactor|develop|test 动作键`…按清单口径）。
- **保留面回归**：explain 动作全流程（面板→执行→结果卡）、讲解/派发/出图链、图谱渲染；驱动回归并入下一停机窗口。
- 四门槛：**新基线 119/6 文件**、tsc/build/check:electron=0。
- project-test 独立验证 + **客户 GUI 目视**（界面再无「一键执行」；动作按钮仅「解释」；动作走右面板）。

## 6. 未决（请客户确认时一并定）

1. 清单整体确认（默认如述）；
2. 「⚠ 依赖未完成」badge：默认移除（可勾回保留）；
3. 服务端底层执行器：默认 **A 案保留**（可切 B 案彻底清）；
4. explain 强化「文档落盘/导出」：建议纳入本次（或紧随小项）；
5. 实施分工（批准后）：agent-pipeline（App/hook/提示词/动作配置）+ graph-view（MapperView）+ 治理（boundary）+ 项目管理（i18n/文档/记录）+ project-test（独立验证）。
