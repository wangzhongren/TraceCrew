# 调度记录 — positioning-alignment（定位对齐：移除一键执行链 + 单点动作收敛 + explain 强化）

> 单写者：项目管理上下文（手工维护）。planRevision: 1
> 方案：[../design/2026-10-16_design_positioning-alignment.md](../design/2026-10-16_design_positioning-alignment.md)（**已批准：客户确认清单整体 + 服务端 A 案 + explain 落盘纳入本次**）
> 口径：客户「专精代码的讲解和解释，而不是去修改」。

## 1. 节点表

| 节点 | 角色 | 交付物 | 写入范围 | 前置 | 状态 |
| --- | --- | --- | --- | --- | --- |
| K1 | agent-pipeline | 删 `useAutoExec.ts`；App 接线/execRecords effect/死 props；ActionDialog 收窄（explain 唯一 + 死组件移除）；ActionPanel 动作卡收敛；删 `autoExecPure.test.ts` | 对应 3 文件 + 2 删除 | 方案批准 | **verified**（attempt 1：52+/611−；hook 352 行与测试 88 行删除〔HEAD 哈希交叉验证〕；**npm test 119/119（6 文件）= 新基线**；残留 grep 全 src 零命中；哈希 `055fbdc1…`/`5377eb0d…`/`194ded16…`） |
| K2 | graph-view | MapperView：按钮块/进度/停止/liveOutput/execRecords 展示/依赖 badge 移除；Props −7×2；动作按钮唯一路径（走右面板） | `MapperView.tsx` | 方案批准 | **verified**（attempt 1：-114/+10，473→369 行；保留面齐在；哈希 `4a98474d…`） |
| K2b | graph-view | 死 props 补删（`onGraphChange?`/`projectPath`） | `MapperView.tsx` | K1 对侧 | **verified**（2 行删；**tsc 全仓 0 错**；哈希 `74f782d1…`） |
| K1b | agent-pipeline | protocolTags 测试头注释修正（4 组件） | `test/agent-pipeline/protocolTags.test.ts` | K1 | **verified**（注释 1 行；该测试 10/10） |
| K4 | project-management | i18n 清理：删 40 枚孤儿键 ×4 包、补 3 枚缺失键（processingCompleteShort/reviewerFailedShort/card.analysisReport）、新增 `action.explainExported`；i18n 测试关键键清单更新 | `src/i18n/*.json`、`test/project-management/i18n.test.ts` | K1 | **verified**（本上下文执行：**116 键/包四包一致**；已删键精确边界零引用闭环校验；**npm test 119/119**）。**过程修正（LX 观察项闭环）**：中途曾因**子串误报**（`processingComplete` ⊂ `processingCompleteShort` 等）误恢复 3 枚键；经 LX 精确边界独立复核确为零引用后**已真正移除**（复核记录见 reportId b2lx-project-test-attempt1 §4） |
| K3 | agent-pipeline | explain 落盘/导出（完成后持久化 `<项目>/.tracecrew/explanations/<label>-<ts>.md` + 结果区路径提示） | `App.tsx`、`ActionPanel.tsx` | K1/K4 | **verified**（attempt 1：隔离增量 App +69/−1、ActionPanel +7/−0；done 门控 explain-success；best-effort 双分支 console.error；纯函数快检〔CJK 保留/清洗/截断/时间戳〕；哈希 `4a3792fa…`/`31449d1f…`；find -newer 零附带自证） |
| LX | project-test | 独立验证（四门槛复跑 + 移除面 grep 零残留 + 保留面回归审读 + 改动面/零改动审计） | `frontend/test/project-test/**`（如需）、本角色 docs | K1–K3 | **verified**（attempt 1，reportId b2lx-project-test-attempt1；结论「通过」）：四门槛 ×2 全绿（119/119、tsc/build/check=0）；移除面零残留（含大小写变体；hooks/ 空、测试恰 6 文件）；explain 导出链全链路核对（App:323-328 门控 → StreamState → ActionPanel:138-142 → 服务端只读 done 契约吻合）；ChatPanel/electron 哈希与 P1 态一致=本批零附带；i18n 独立复核（在用 94 字面键全存在）；K3 纯函数快检通过。**观察 1 项**（i18n 子串误报→已闭环，见 K4 行）；**口径补记建议 1 项**（服务端提示词表 A 案留存，见方案 §2 注）；GUI 清单建议版已产出（转客户） |
| 治理 | ANS Governance | `agent-pipeline/boundary` 移除 `useAutoExec.ts` 行（+changelog）；README 使用示意更新安排 | — | K1 | **已完成**（协调者转达：boundary.md/.yaml 移除该行 + App.tsx 行描述同步 + changelog；role-card 四处陈旧提及刷新；**README.md 增列入项目管理 Section 1**） |
| 文档 | project-management | README 使用示意更新（移除一键执行/四动作、补「讲完即画」与 explain 导出）+ architecture.md 6 处 + e2e-live-test 注记 + memo | `README.md`（治理已增补入白名单）、本角色 docs | K1 | **verified**（本上下文执行：README 7+/10−、陈旧词零残留；architecture.md 六处定位对齐更新；记录闭环） |

## 2. 事件历史

| seq | 时间 | 事件 kind | 节点 | 摘要 |
| --- | --- | --- | --- | --- |
| 1 | 2026-10-16 | assigned | 全部 | 客户批准清单整体（含依赖 badge 默认移除）+ 服务端 A 案 + explain 落盘纳入；两路勘察数据入方案；**K1/K2 并行派发**（接口过渡态明示） |
| 2 | 2026-10-16 | verification-passed | K2 | 核验通过：diff -114/+10；清单 1-8 逐项；零残留自查；唯一 tsc 错为对侧过渡态（已预告） |
| 3 | 2026-10-16 | verification-passed | K1 | 核验通过：**119/119（6 文件）**、残留零；死组件移除前 grep 复核零引用；上游决策项入档（downstreamNodes 惰性管线保留待 app-shell 一并清；服务端 A 案保留；need_replan 不可达保留） |
| 4 | 2026-10-16 | verification-passed | K2b/K1b/K4 | K2b：tsc 全仓 0 错；K1b：注释修正 10/10；K4：i18n 清理（当时 119 键/包） |
| 5 | 2026-10-16 | dispatched | K3 | explain 落盘/导出派发（i18n 键 `action.explainExported` 已就位） |
| 6 | 2026-10-16 | verification-passed | K3/联合门槛 | K3 核验通过（见节点行）。**联合四门槛全绿（本上下文）**：npm test **119/119 ×2**（6 文件）、tsc=0、build=0、check:electron=0。**LX 独立验证派发**；「可复验」时点（HMR 即时）待报 |
| 7 | 2026-10-16 | closed | LX | **LX 独立验证通过**（见节点行）；两处口径闭环：① i18n 子串误报（3 僵尸键）经精确边界复核后真正移除 → **116 键/包**、测试仍 119/119（本上下文执行）；② 方案 §2 补记「服务端提示词表 A 案留存」注。**批闭环**；「可复验」时点已报（HMR 渲染层即时、无主进程改动）；未测项：客户 GUI 目视（清单已转）+ 实机 explain 端到端导出（GUI 目视含）。待治理同步：boundary 移除 useAutoExec 行、README 使用示意、changelog |
| 8 | 2026-10-16 | closed | 治理/文档 | **治理三件已完成**（boundary 行移除 + role-card 刷新 + README 入白名单）；**README 使用示意已更新**（定位语/流程行/界面示意/功能清单；陈旧词零残留；7+/10−）；architecture.md 六处与 e2e 注记同步；memo 更新。**本批全链闭环**（K1–K4、K2b/K1b、K3、LX、治理、文档） |
