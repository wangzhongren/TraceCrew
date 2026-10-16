# 调度记录 — chat-input-enhance（聊天输入增强：① 图片发送 ② 思考强度三档）

> 单写者：项目管理上下文（手工维护）。planRevision: 1
> 方案：[../design/2026-10-16_design_chat-input-images-thinking.md](../design/2026-10-16_design_chat-input-images-thinking.md)（**已批准**：客户确认 4 项清单；**默认思考档=中（adaptive）**——客户指定，实现为单常量）
> 关键口径：三档=同模型 `deepseek-v4-flash` + `thinking.type`（disabled/adaptive/enabled）；图片 × 三档全兼容；**涉 electron 主进程 → 可复验需重启应用**。

## 1. 节点表

| 节点 | 角色 | 交付物 | 写入范围 | 前置 | 状态 |
| --- | --- | --- | --- | --- | --- |
| I0 | project-management | i18n 12 键（图片 4 + 强度 7 + reasoning 1）×4 语言包 | `src/i18n/*.json` | — | **verified**（本上下文执行；116→128 键/包、四包一致、可解析） |
| I1 | agent-pipeline | ② 三档（ChatPanel 控件/常量/请求体 thinking → routes 校验 400 → processStream 透传 → reasoning 呈现修复）+ ① 图片（三入口/压缩/缩略图/请求体 images → routes 校验 → processStream parts 组装） | `ChatPanel.tsx`、`routes/agent.ts`、`agent.ts` | I0 | **verified**（attempt 1）：②+① 两阶段分跑门槛全绿；ChatPanel `+439/−39`、routes `+87/−2`、services `+51/−1`；**终审拦截并修复一处契约不一致**（客户端 thinking 线格式 string→`{type}` 对象，否则全链 400——类型门槛不可捕获，已列入 I-LX 审计项）；未动面自证（App/runActionStream/planStream/9 处注入消息 0 行）；哈希 `e4652957…`/`b5432154…`/`920630f2…`。**持留 1 项**（index.ts 属 app-shell）→ I2 |
| I2 | app-shell | `electron/server/index.ts` body 上限 `2mb→8mb`（一行） | `index.ts` | I1 | **verified**（attempt 1：diff 恰 1 行；check:electron=0；哈希 `d463e74f…`） |
| J1 | agent-pipeline | 三档控件样式调整（客户反馈「样式怪」）：单行等宽三段 `[思考强度][低|中|高]`（28×18px、发丝外框方角 3px、选中墨蓝白字）、hint 收进 tooltip、窄面板旁侧文字 `min-w-0` 截断优先 | `ChatPanel.tsx` | I-LX（客户反馈） | **verified**（attempt 1：diff 5+/6−；行为零变更；tsc ×3=0、npm test 119/119；哈希 `1c3d43f7…`。未采取：发送键位置未动〔超范围〕；本机无预览，视觉由客户 HMR 目检） |
| I-D | project-management | 收口（文档/记录、可复验时点与重启说明、GUI 清单终版） | 本角色 docs | I-LX | **verified**（本上下文执行；设计文档置 verified、seq 3 收口、GUI 清单终版已转、可复验时点已报〔需重启〕；J1 样式调整并入清单第 ① 条） |
| I-LX | project-test | 独立验证（四门槛 + 三档/图片请求面审计 + 隔离增量 + 零附带） | `/tmp/b2lx2/**`、本角色 docs | I1/I2 | **verified**（attempt 1，reportId b2lx2-project-test-attempt1；结论「通过」）：四门槛 ×2 全绿；**请求面契约机械探针 46/46**（含修正前 string 形状可复现 400；canvas 离屏真实执行压缩链：2400×1600/2560×1440→1400 长边、JPEG 前缀、±1 字节；≥768001 拒）；**上限核算**：最坏 3 图 1.2MiB→线 ≈1.60MiB + 1MB 历史 ≈2.60MiB **超旧 2MB**——「8mb 成立且为鲁棒性所需，非单纯余量」（修正我方口径）；机制/呈现/128 键/parts 仅末条 user/9 处注入字符串全对；隔离增量与零改动证明齐。未测：真实 API e2e（视觉问答/三档实测）、GUI（重启）、断网恢复真机。观察（低优先）：恢复路径可组合 >1.2MB（8MB 下无碍）/历史卡徽标随当前档/无附件非 ok 静默空（不可达）/新请求面零单测（建议后续补） |

## 2. 验收口径（方案 §2.6/§1.4，客户确认版）

1. 三档真实场景：低=极速无思维链、中/高=思维链折叠区+徽标；**默认中档生效**；
2. 图片真实场景：粘贴截图问「这段报错怎么理解」→ 回答针对图中内容；三档下均可用；
3. 四门槛 + project-test 独立验证 + 客户 GUI 目视（截图问答 + 三档切换试手）。

## 3. 事件历史

| seq | 时间 | 事件 kind | 节点 | 摘要 |
| --- | --- | --- | --- | --- |
| 1 | 2026-10-16 | assigned | 全部 | 客户批准（默认档=中 override、单常量实现）；I0（i18n 12 键）本上下文执行并核验；**I1 派发**（agent-pipeline；② 先行 ① 随后，同上下文串行以避接口过渡） |
| 2 | 2026-10-16 | verification-passed | I1/I2 | I1 核验通过（哈希/机制抽查/契约修正/未动面；见节点行）；边界持留项经 **I2（app-shell 一行）**落地核验；**联合四门槛全绿（本上下文）**：tsc=0、npm test **119/119（6 文件）**、build=0、check:electron=0。**I-LX 独立验证派发**（含线格式契约请求面审计 + 客户端上限余量核算）；「可复验」时点报协调者（**需重启应用**——主进程变更） |
| 3 | 2026-10-16 | closed | I-LX/I-D | **I-LX 独立验证通过**（见节点行；含契约探针 46/46、canvas 真实压缩链、上限核算修正〔8mb=鲁棒性所需〕、四条低优先观察）；I-D 收口：设计文档置 verified、记录闭环、**GUI 清单终版**与「可复验=需重启」已报协调者。**批闭环**。未测项如实：真实 API e2e（视觉问答/三档 CoT 实况）、GUI 目视、断网恢复真机。全程零 git 提交 |
| 4 | 2026-10-16 | verification-passed | J1 | 客户反馈三档控件「样式怪」→ J1 调整为单行等宽三段 + hint 入 tooltip + 窄面板截断优先；核验：diff 5+/6−、行为零变更、tsc ×3=0、119/119、哈希 `1c3d43f7…`；**HMR 即时交付客户目检**（纯渲染层），迭代回路就绪 |
