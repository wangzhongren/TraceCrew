# 调度记录 — e2e-live-test（TraceCrew 产品 LLM 端到端真实链路验证）

> 单写者：项目管理上下文（手工维护）。planRevision: 1
> 性质：完整流程/真实入口测试（project-test 主导执行、独立报告；项目管理协调与核验）。

## 1. 任务与授权

- **任务**：对 TraceCrew 产品补齐至今未实测的「LLM 端到端真实链路」：T1 只读分析（真实模型响应、工具调用含 search、SSE 完整）；T2 小功能需求走计划流（PM→Architect→Planner→Reviewer→Mapper，产出 call_graph/sequence_graph）；T3（可选）单节点 action/stream（explain）。
- **授权记录（2026-10-16，经协调者转呈的客户确认）**：客户指令「找个真实的项目测试一下」；① 靶项目 = `~/code/vibeingcode/ans-testbed/kanban-live-4` 的**离场副本**；② 客户知情并同意「该副本的代码将被发送至其自有 LLM 代理进行分析」（产品正常功能；token 费用客户已知情）。
- **硬边界**：源目录与其它任何用户目录**绝对只读**；流水线所有写入只能落在副本内；TraceCrew 仓库工作区零源码写入（不对 TraceCrew 自身跑流程）；**不做**一键自动执行（auto-exec 全链）。（2026-10-16 定位对齐后该链已从产品整体移除，本边界条款自动满足。）

## 2. 环境布置（协调者已执行，2026-10-16）

- 副本：`/tmp/tracecrew-e2e/kanban-live-4`（`rsync -a` 全量复制；124 文件与源一致；git HEAD `8038fda` 与未跟踪状态保留；靶项目为「kanban-live」——纯 Node 内置模块、零第三方依赖、127.0.0.1 的中文任务看板，入口 `src/server.js`）。
- 源基线：`/tmp/tracecrew-e2e/source-baseline.sha`（124 项 sha256 清单；收口时复跑比对证明源未被动过）。
- 证据目录：`/tmp/tracecrew-e2e/evidence/`（worker 创建并落盘原始 SSE）。

## 3. 节点表

| 节点 | 角色 | 交付物 | 写入范围 | 前置 | 状态 |
| --- | --- | --- | --- | --- | --- |
| E2E-1 | project-test | T1/T2/T3 执行 + 原始证据 + 三态报告 | `/tmp/tracecrew-e2e/**`（副本与证据；TraceCrew 仓库只读） | 客户授权 + 副本就绪（已满足） | **verified**（attempt 1；17 次真实请求，发现 F1–F6） |
| E2E-V | project-management | 核验（证据抽查、源只读证明、边界合规）与转呈 | 本角色 docs | E2E-1 完成（已满足） | **verified**（2026-10-16） |
| E-F1 | agent-pipeline | F1/F2/F4/F5/F6/F7（`agent.ts`）+ 回归测试（F1 假客户端 / F2 映射 / F4 清洗） | `electron/server/services/agent.ts`、`frontend/test/agent.test.ts` | 客户确认实施口径（已满足） | **verified**（attempt 1；npm test 103/103） |
| E-F2 | agent-pipeline | F3 双层：5 组件渲染期清洗补全 + ChatPanel done 替换 + O-F3 共享工具 + 单测 | `frontend/src/components/{ChatPanel,PlanCard,ReviewCard,ActionDialog,ActionPanel}.tsx`、`frontend/test/agent-pipeline/**` | 客户确认实施口径（已满足） | **verified**（attempt 1；npm test 113/113） |
| E-F2b | graph-view | 收敛 `MapperView.tsx` 内联清洗链 → 共享工具 `cleanProtocolTags`（O-F3 单点维护的收尾遗漏点；经裁定纳入） | `frontend/src/components/MapperView.tsx` | E-F2 共享工具已就绪（已满足） | **verified**（attempt 1；diff 2+/2−） |
| E-F3 | project-test | 无干预复跑 E2E 对照（T1/T2/T3 + O-F1a 写路径轮次）+ 独立报告 | `/tmp/tracecrew-e2e/**` | E-F1、E-F2 | **verified**（attempt 1；**6/6 全通、F1 命中 0/11**） |
| E-F1b | agent-pipeline | 残余 1 补正：`cleanDoneMessage` 覆盖非规范闭合形态（`</final>` 等） | `electron/server/services/agent.ts`、`frontend/test/agent.test.ts` | 裁定（补一行） | **verified**（attempt 1；114/114） |
| E-F4 | project-management | 规则/记录收口 + 最终报告 | 本角色 docs | E-F3 | **verified**（2026-10-16 完成） |

## 4. 验收口径

- T1：真实模型响应（非报错/非空）、观察到工具调用流（`tools` 事件）、**search 实际返回真实匹配的证据**（模型叙述引用真实文件/行号等可核对片段）、SSE 完整以 `done` 收束、无异常。
- T2：PM（如需澄清则以真实用户角色简短回答）→ Architect → Planner → Reviewer → Mapper 全链完成；**call_graph 与 sequence_graph 的 JSON 实际产出**（nodes/edges 可解析、节点指向本靶项目文件）；Reviewer 结论明确。
- T3（可选）：explain 只读动作产出文档、无对副本写入。
- 全程：源只读（收口复跑源清单比对为零差异）；写入仅限副本；收尾只终止自有进程；三态结论 + 未测项（GUI 可视终确认留客户）。

## 5. 事件历史

| seq | 时间 | 事件 kind | 节点 | 摘要 |
| --- | --- | --- | --- | --- |
| 1 | 2026-10-16 | assigned | E2E-1 | 授权与边界入档；副本与源基线就绪；派发 project-test（attempt 1） |
| 2 | 2026-10-16 | implementation-reported | E2E-1 | 报告经协调者转交（reportId e2e-t1t3-project-test-attempt1）：17 请求全 HTTP 200；T1 通过（含 search 真实匹配抽查全真；4 试 1 成）、T2 通过（带干预，2/6 段无干预；call_graph 11/9 + sequence_graph 9/8）、T3 首试通过；副本与源只读证明通过；发现 F1（高，11/17 踩中）等 6 项 |
| 3 | 2026-10-16 | verification-passed | E2E-1、E2E-V | 抽查一致：attempt4 SSE 205KB/5769 事件/110 工具操作；attempt1 短流 1.4KB（F1 签名 `done.message` 含原始标签）；图谱 JSON 实解析 11/9 与 9/8；源清单 diff 为空、副本无 `.tracecrew`、端口释放；**F1 代码定位逐字确认**（`agent.ts:913-918` 终态检查先于 942-960 工具执行并 return） |
| 4 | 2026-10-16 | approved | F 系列（提议） | 客户表态「把这些问题都修掉吧」——批准修复全部 6 项 + `app.log` 调试噪音清理；形式化提案与实施口径确认呈报中 |
| 5 | 2026-10-16 | assigned | E-F1、E-F2 | 客户确认实施口径（F1 对齐动作流语义、F2 映射修正、F3 双层且**完成期归零**、F4–F7、无干预复跑对照；**O-F3/O-F1a 均采纳**）；E-F1（agent.ts：F1/F2/F4/F5/F6/F7）与 E-F2（5 组件 + O-F3 共享工具）并行派发 |

## 7. 收口

**e2e-live-test 任务于 2026-10-16 闭环**：E2E-1/E2E-V 与 E-F1/E-F2/E-F2b/E-F1b/E-F3/E-F4 全 verified；核心验收——**无干预完整链路 2/6 → 6/6、F1 命中 11/17 → 0/11**，可对照数据与原始证据（`/tmp/tracecrew-e2e/evidence/` 修复前 + `t3r-*` 修复后）留档；门禁 114/114、tsc=0、build=0、check:electron=0。记录侧：提案 [../fix/2026-10-16_fix_e2e-findings.md](../fix/2026-10-16_fix_e2e-findings.md) 置 verified；规则新增 R20（流式终态语义）与 T11（残余观察）；`docs/architecture.md` 与批 1 记录不受影响。**未提交**（待客户；GUI 可视确认进行中）。
| 6 | 2026-10-16 | verification-passed | E-F1 | 核验通过：diff 逐 hunk 审阅（F1 终态判定整体移入 `operations.length===0` 块、ops 路径直通工具执行与回喂、注释注明与 runActionStream 同语义；cleanDoneMessage 三标记清洗（handoff/final/done）；F2 if/else 映射；F5/F6 提示词；F7 删 5 处调试打印）；哈希 `c7cd4550…`/`4ff06ab2…` 与报告一致；**npm test 103/103**（98+5，红→绿证据充分）、`tsc`=0、`check:electron`=0、调试打印 grep 零命中。E-F1 verified（E-F2 报告中） |
| 7 | 2026-10-16 | verification-passed | E-F2 | 核验通过：共享工具 `cleanProtocolTags` 四类有序规则 + 误伤防护（`<b>`/`<dataFile>` 等不受影响单测）、6 接入点（5 组件 + PinnedPlanCard popup）、`applyDoneMessage` 完成期替换（守卫：空串不替换；fullText 原文不动）；旧 cleanTags 与内联清洗零残留；哈希与报告一致（ChatPanel `b06804ea…`、测试 `f2e232f4…`）；**npm test 113/113（6 文件）**、tsc=0、check:electron=0、新测试 10/10。裁定：`MapperView.tsx` 内联链属 O-F3 遗漏点 → 派 E-F2b（graph-view 小节点，并入最终报告注明） |
| 8 | 2026-10-16 | assigned | E-F2b、E-F3 | E-F2b（graph-view 渲染侧单点收敛）与 E-F3（project-test 无干预复跑对照：同副本/同驱动、T1/T2/T3 + O-F1a 写路径轮次；对照基线 2/6 段与 11/17 命中）并行派发 |
| 9 | 2026-10-16 | verification-passed | E-F2b | 核验通过：diff 恰 2+/2−（L3 import 并入；L247 内联 4 连 `.replace` 链 → `cleanProtocolTags(liveOutput[node.id] || '') || '⏳ 等待 Agent 响应...'`，降级保留）；哈希 `fa917f9c…` 与报告一致；`list-dir\|read-file` 内联零残留（标签名现仅存于 ActionDialog 常量）；tsc=0、npm test 113/113（6 文件）、check:electron=0。如实标注：F3 超集行为差异（新增既有清单之外的标记剥离与空行归一）属预期。E-F2b verified；E-F3 复跑进行中 |
| 10 | 2026-10-16 | verification-passed | E-F3 | 核验通过：**对照表——无干预 6/6 全通（基线 2/6）；F1 签名 0/11（基线 11/17）**；T1 2/2 首试（95/114KB 长链）、T2 全链首试（PM 11 请求体 grep 自检 0 干预文本）、图谱首试产出、F5 行号 10/10 全真、app.log 29KB 噪声 0；O-F1a 写路径通过（writecheck 仅 `notes/hello.md`）；证据 t3r-* 全套；三重只读证明（副本零差异/源 SOURCE-CLEAN/仓库 11 项变更与预期一致）；端口 19850 当前监听 PID 98161＝**客户 GUI 可视确认实例**（非我方进程，未处置）。E-F3 verified |
| 11 | 2026-10-16 | assigned | E-F1b | 裁定残余 1＝**补正**（同一 F1 口径的直接完备化）：`cleanDoneMessage` 覆盖 `</final>` 等非规范闭合形态；派 agent-pipeline 小节点（E-F1b） |
| 12 | 2026-10-16 | verification-passed | E-F1b | 核验通过：三条 replace 扩为 `</?final\s*\/?>` 等全形态（注释同步）+ 1 条新用例（既有零改动）；哈希 `f0848a87…`/`c11ccebe…` 一致；**npm test 114/114（6 文件）**、tsc=0、check:electron=0。E-F1b verified |
| 13 | 2026-10-16 | completed | 全部 | **E 系列任务闭环**（E-F1/E-F2/E-F2b/E-F1b/E-F3/E-F4 全 verified）：无干预 6/6、F1 命中 0/11、O-F1a 写路径通过；门禁 114/114、tsc=0、build=0、check:electron=0；提案置 verified、R20/T11 与记录归目完成；**提交/推送待客户指令（GUI 可视确认进行中）** |

## 6. 小项与观察项

- **F1–F6 与调试噪音（F7）已形式化**：修复提案 [../fix/2026-10-16_fix_e2e-findings.md](../fix/2026-10-16_fix_e2e-findings.md)（客户已表态全修；一次性实施口径确认已通过，全案闭环）。
- 真实链路基线（修复前对照）：**无干预完成率 2/6 段；F1 命中 11/17 请求**；T1/T2/T3 在带干预下均可走通。
- **E 系列闭环（2026-10-16）**：无干预对照 **6/6 全通**、F1 命中 **0/11**、O-F1a 写路径通过；门禁 **114/114**、tsc=0、build=0、check:electron=0；三重只读证明通过（源 SOURCE-CLEAN / 副本零差异 / 仓库运行未写）。节点 E-F1/E-F2/E-F2b/E-F1b/E-F3/E-F4 全 verified。
- **残余观察（不阻断）**：① PM done.message 保留 `<confirmed-requirement>` 容器、Mapper 含 call_graph JSON 正文（属结构容器/正文，GUI 级观察）；②「收束信号**检测**口径」保持严格字面（`</final>` 不触发收束；实测无此症状，模型会补规范形式；放宽属新裁定）——清洗侧已由 E-F1b 完备；③ 未测项：GUI 可视终确认（**客户进行中**）、`/plan/stream`、auto-exec、Windows。
- **E-F2b（题外收尾）**：MapperView 内联清洗链收敛为共享工具（O-F3 遗漏点，经裁定纳入；diff 2+/2−）。
- **局限（沿报）**：GUI 可视终确认留客户；写入类 action 与 auto-exec 未测；`/plan/stream` 未测。
- **提交状态**：E 系列全部变更**未提交**（等客户指令；客户 GUI 可视确认进行中；19850 监听为客户的确认实例，未处置）。
