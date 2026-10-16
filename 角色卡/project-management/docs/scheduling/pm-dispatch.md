# 调度记录 — pm-dispatch（PM 调度设计与画图：只读咨询分流 + 回报回路）

> 单写者：项目管理上下文（手工维护）。planRevision: 1
> 设计方案：[../design/2026-10-16_design_pm-dispatch-design-draw.md](../design/2026-10-16_design_pm-dispatch-design-draw.md)（**已批准：客户确认全部默认项 2026-10-16**）
> 前置：无（与「回答呈现」修复同工作树推进；两者文件有交叠 → 串行执行）。

## 1. 任务与授权

- **任务**：PM 可调度 Architect（设计）与 Mapper（画图）；完成后回报 PM 汇总呈现；多代理卡片呈现流程一并落地。
- **授权记录（2026-10-16，经协调者转呈的客户确认）**：全部默认项批准（① 标签命名与分流规则；② v1 即开「先设计后画图」；③ 汇总轮不自动二次派发、仅用户显式再要；④ Architect 咨询卡 v1 保留 JSON 正文）。
- **硬边界**：主流水线（handoff-to-planner 路径/四函数体）零改动；只读咨询不写文件；全程不提交 git。

## 2. 节点表

| 节点 | 角色 | 交付物 | 写入范围 | 前置 | 状态 |
| --- | --- | --- | --- | --- | --- |
| D0 | project-management | i18n 系统胶囊 2 键（`chat.dispatchArchitect`/`chat.dispatchMapper`×4 语言包） | `frontend/src/i18n/*.json` | — | **verified**（本上下文执行；150→152 键/包，键集四包一致，可解析） |
| D1 | agent-pipeline | 实施：agent.ts（PM 提示词分流规则、done 分支 ×2、cleanDoneMessage ×2、重试文案）+ ChatPanel.tsx（两派发分支 + `runArchitectConsult`/`runMapperConsult`/`runConsultReportBack`）+ ActionDialog.tsx（PROTOCOL_TAG_NAMES ×2） | 对应 3 文件 | D0 | **verified**（attempt 1）：ChatPanel **纯插入 130+/0−**（主流水线四函数体逐字节未动，agent 用函数体 sha256 自证 + 本上下文零删除复核）；ActionDialog 恰清单行；agent.ts 四处与规格一致（done 双分支位置正确：planner 后、universal 前）；**四门槛全绿**（tsc=0、npm test 119/119、build=0、check:electron=0）；哈希 `ee82e2c6…`/`3b59c055…`/`150344f4…`。**外部并发提交说明**：会话期间外部提交 `93bec0c` 吸收 agent.ts 四处改动（blob 哈希逐字核验无损无重复） |
| D-V | project-test | 批末独立验证（四门槛复跑 + 主流水线零改动审计 + 标签/清理面核验 + 回归场景 API 驱动〔端口可用时〕） | `frontend/test/project-test/**`（如需）、本角色 docs | D1 | **verified**（attempt 1，reportId b2dv-project-test-attempt1；结论「通过〔5/5 已执行项〕」）：四门槛独立 ×2 全绿；**删增行重建法证明 ChatPanel 逐字节等价 93bec0c（纯插入 130 行）**、五主流水线函数零改动、agent.ts sha 一致；协议面 4 触点覆盖 + 清洗器三形态 25/25、cleanDoneMessage 7/7；行为面（顺序/防重复/挂图/无 autoCollapse）全符合；零写入证明通过。**未测 1 项**：API 驱动回归（端口被客户实例占用；替代交付 = 带端口守卫的驱动 `/tmp/b2dv/chain-dv.mjs`，待窗口一次性执行）。**注**：设计稿字面 `dispatchInFlight` 引用位未实现，以「派发仅在交互轮 + 汇报轮直连」结构性等价达成（记为措辞差异，非缺陷） |
| D-D | project-management | 收口（提案/记录、可复验时点报送、未测项如实） | 本角色 docs | D-V | **verified**（本上下文执行）：设计文档置 implemented（事件链完整）；「可复验」时点已报；**客户已实测**本功能（派发→Mapper 咨询→卡流正常触发）——并踩中新缺陷（轮次上限/循环）另行立案见下 |

**写集冲突**：D1 三文件与 D0 的 i18n 不交；与 ui-redesign/回答呈现批同工作树（D1 基于其后状态增量）。
**客户就地复验**：修复经 HMR 进客户运行实例；D1 完成核验后报送「可复验」时点。

## 3. 验收口径（来自设计方案 §6-7）

四门槛（119/119、tsc/build/check=0）→ 主流水线语义零改动自证 → **回归=客户真实案例复刻**（「了解这条抖音发送链路」→ 自动画图 → PM 汇报卡；API 驱动、只读、逐事件）→ project-test 独立验证 → **客户 GUI 目视**。

## 4. 事件历史

| seq | 时间 | 事件 kind | 节点 | 摘要 |
| --- | --- | --- | --- | --- |
| 1 | 2026-10-16 | assigned | 全部 | 客户批准全部默认项；D0（i18n 2 键）本上下文执行并核验；**D1 派发**（agent-pipeline；主流水线零改动为硬边界） |
| 2 | 2026-10-16 | verification-passed | D1 | 本上下文核验通过（纯插入/零删除/双分支位置/四门槛全绿，见节点行）。**外部提交备注**：16:56 前后协调者侧提交 `93bec0c`（UI 蓝图室+新图标+回答呈现修复）与 `2691147`（文档归档），前者吸收 D1 的 agent.ts 四处（哈希逐字核验无损）；当前工作区未提交 = ChatPanel/ActionDialog 两文件（D1 前端部分）。**「可复验」时点已报协调者**（HMR 已进客户运行实例）。**D-V 派发** |
| 3 | 2026-10-16 | closed | D-V/D-D | D-V 独立验证通过（5/5 已执行项；API 驱动回归因客户实例占用留档待窗口，驱动就绪）；D-D 收口：设计文档置 implemented、可复验时点已报。**客户实测确认功能链路正常触发**（派发→Mapper 咨询→卡流）。**遗留**：① API 驱动回归（待窗口，可与「回答呈现」复现器共用机会，二者脚本已就绪）；② 客户实测踩中的「轮次上限/重复循环」缺陷已另案立案（见设计文档 `../design/2026-10-16_design_turn-limit-wrapup.md`）。记录闭环 |
| 4 | 2026-10-16 | regression-executed | D-V | **API 驱动回归已执行**（协调者停机窗口，自有实例，自停+零写入证明）：b2dv 单发客户首句「你看下这个项目，我需要了解一下，这个抖音发送的链路是怎么走的」→ PM **未自动派发**（完整答复 2190 字级别链路梳理 + 主动提议「要不要交给绘制者出图」，其 CHECK=FAIL(no-mapper-handoff)）；**明示场景派发实证**：b2r b3「你怎么不给我画图啊」→ PM 认错并输出 `<handoff-to-mapper/>`（拼接文本核对 ✓）。**判定**：分流机制 API 侧确证生效；「首句自动派发 vs 先答复+提议」= 模型行为调优观察项（候选：PM 提示词微调——对明确「链路/图」意图直接派发；亦可保留"提议+一次确认"体验，另行评估）。残留未测：渲染层驱动（客户就地使用覆盖中） |
| 5 | 2026-10-16 | decision | D-V 调优项 | **客户定口径**（原话「这个我觉得还是成为工作流的一部分吧，正常讲完了都画一个吧」）：出图成为只读咨询**常规环节**——PM 实质讲解后**默认派发 Mapper、无需确认**（四类例外：寒暄/速问/明确不要图/显式其他去向）。短方案（单点修订：仅 PM 提示词一段 + 回归驱动；协议/前端链路全复用；成本增量 +1.5~2× token、+15~60 秒如实列明）：`../design/2026-10-16_design_dispatch-default-draw.md`，待一次口径确认后实施 |
| 6 | 2026-10-16 | verification-passed | P1 | 客户批准全部默认项；**P1 实施并核验**：PM 提示词【只读咨询派发】段整段修订（默认出图+四例外），唯一改动（+5/−4）；check:electron=0、npm test 124/124；哈希 `9e81eb10…`。**「可复验」时点已报**（需重启应用）；**驱动回归待短停机窗口**（`/tmp/b2x/rundv.sh` 就绪：自有实例 → 客户案例链 → 断言末轮 tokens 含 `<handoff-to-mapper/>` → 自停，约 3 分钟） |
| 7 | 2026-10-16 | regression-executed | P1 | **驱动回归 PASS**（停机窗口 19:40:25–19:41:24）：客户案例首句 → PM 讲解完成后**直接**输出 `<handoff-to-mapper/>`（CHECK=PASS、mapper_in_tokens=True；尾串「已把这份链路梳理交给绘制者出图，完成后向你汇报。」）——「讲完即画」口径生效、**无二次要图**；自停+端口释放+零写入证明。**PT-V 静态独立验证派发** |
| 8 | 2026-10-16 | verification-passed | PT-V | **PT-V 独立验证通过（5/5）**（reportId b2pv-project-test-attempt1）：① 批准文本逐字比对=语义等同（6 处措辞/示例省略如实列出，四要素无缺）；② **哈希级重建证明**：反打 hunk 得 `92e1e43c…`（=T-V 验证态）→ `9e81eb10…` 唯一增量 = 该段、无第三态；全代码域 65 文件受控比对唯一差异=agent.ts；③ 门槛复跑 check:electron=0/tsc=0/124/124；④ 驱动证据审读=足以支撑口径生效（如实标注局限：N=1 正向单例、语境含近限收尾、渲染层与四类例外边界未测）；⑤ 零改动证明。**P1 批全链闭环**；未测项：客户 GUI 目视 + 边界例（如实） |
