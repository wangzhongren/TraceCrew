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
| D1 | agent-pipeline | 实施：agent.ts（PM 提示词分流规则、done 分支 ×2、cleanDoneMessage ×2、重试文案）+ ChatPanel.tsx（两派发分支 + `runArchitectConsult`/`runMapperConsult`/`runConsultReportBack`）+ ActionDialog.tsx（PROTOCOL_TAG_NAMES ×2） | 对应 3 文件 | D0 | running（attempt 1） |
| D-V | project-test | 批末独立验证（四门槛复跑 + 主流水线零改动审计 + 标签/清理面核验 + 回归场景 API 驱动〔端口可用时〕） | `frontend/test/project-test/**`（如需）、本角色 docs | D1 | pending: D1 |
| D-D | project-management | 收口（提案/记录、可复验时点报送、未测项如实） | 本角色 docs | D-V | pending |

**写集冲突**：D1 三文件与 D0 的 i18n 不交；与 ui-redesign/回答呈现批同工作树（D1 基于其后状态增量）。
**客户就地复验**：修复经 HMR 进客户运行实例；D1 完成核验后报送「可复验」时点。

## 3. 验收口径（来自设计方案 §6-7）

四门槛（119/119、tsc/build/check=0）→ 主流水线语义零改动自证 → **回归=客户真实案例复刻**（「了解这条抖音发送链路」→ 自动画图 → PM 汇报卡；API 驱动、只读、逐事件）→ project-test 独立验证 → **客户 GUI 目视**。

## 4. 事件历史

| seq | 时间 | 事件 kind | 节点 | 摘要 |
| --- | --- | --- | --- | --- |
| 1 | 2026-10-16 | assigned | 全部 | 客户批准全部默认项；D0（i18n 2 键）本上下文执行并核验；**D1 派发**（agent-pipeline；主流水线零改动为硬边界） |
