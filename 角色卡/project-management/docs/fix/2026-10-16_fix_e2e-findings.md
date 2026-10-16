---
id: fix-e2e-findings
type: fix
title: 修复 E2E 真实链路发现（F1–F6 + 调试噪音 F7）
created: "2026-10-16"
updated: "2026-10-16"
timezone: Asia/Shanghai
status: verified
related: []
events:
  - date: "2026-10-16"
    kind: created
    summary: E2E 真实链路测试（kanban-live 副本）发现 6 项缺陷（F1 高危）与调试噪音；客户已表态全修；形式化修复方向与验收口径，待一次确认后派发
  - date: "2026-10-16"
    kind: implemented
    summary: 客户确认全部（含 O-F3/O-F1a）；E-F1/E-F2 实施核验；E-F1b 补正闭合形态；E-F2b 收敛 MapperView 内联链
  - date: "2026-10-16"
    kind: verified
    summary: E-F3 无干预对照复跑——6/6 全通（基线 2/6）、F1 命中 0/11（基线 11/17）、O-F1a 写路径通过；门禁 114/114、tsc=0、check:electron=0；三重只读证明通过
---

# 修复 E2E 真实链路发现（F1–F6 + 调试噪音 F7）

> 状态：**已验证（2026-10-16 闭环）**。来源：E2E 真实链路测试（project-test，reportId `e2e-t1t3-project-test-attempt1`）；调度记录 [../scheduling/e2e-live-test.md](../scheduling/e2e-live-test.md)；原始证据留档 `/tmp/tracecrew-e2e/evidence/`（修复前）与 `t3r-*`（修复后）。
> 客户取向：**全部修复**（原话「把这些问题都修掉吧」，含 `app.log` 调试噪音清理）。本提案请客户对**修复方向与验收口径**做一次确认后即派发，不再逐项往返。

## 实施结果（2026-10-16 闭环）

| 项 | 落地节点 | 结果 |
| --- | --- | --- |
| F1 + F4 | E-F1（重构 + 清洗口径）/ E-F1b（闭合形态补正） | 终态判定**仅在无操作轮生效**（有 ops 先执行、回喂、继续）；`cleanDoneMessage` 覆盖 `<final>`/`</final>`/`<final/>` 全形态 |
| F2 | E-F1（`'assistant'||'agent'` → assistant） | 映射回归测试三例 |
| F5 / F6 | E-F1（Mapper 两条自检 / Architect 一句） | E-F3 实测：行号 **10/10 全真**、label/lane 全一致；F6 改善（附理由，非硬指标） |
| F7 | E-F1（删 5 处调试打印） | app.log 378KB → **29KB**、噪音 0 |
| F3 + O-F3 | E-F2（共享 `cleanProtocolTags` + 完成期替换）/ E-F2b（MapperView 收敛） | 6 接入点 + 渲染期/完成期双层；内联链零残留（标签名仅存于共享常量） |

**E-F3 无干预对照复跑（核心验收）**：

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| 无干预完成段数 | 2/6 | **6/6 全通** |
| F1 签名命中（短流/0 tools/含标签） | 11/17 请求 | **0/11** |
| O-F1a 写路径（同轮 ops+`<final/>`） | — | 通过（仅 writecheck 副本内创建 `notes/hello.md`；副本外零写入） |
| T1 / T2 / T3 | 4 试 1 成 / 带干预 / 首试 | 2/2 首试 / 全链首试 / 首试 |

门禁（E-F1b 后）：`npm test` **114/114（6 文件）**、`tsc`=0、`build`=0、`check:electron`=0；三重只读证明通过（源 `SOURCE-CLEAN`、副本零差异、仓库运行未写）。

**残余与观察（不阻断）**：① `</final>` 非规范**清洗**已由 E-F1b 补正；② PM done.message 保留 `<confirmed-requirement>` 容器、Mapper 含 call_graph JSON 正文——属结构容器/正文（GUI 级观察）；③ **收束信号检测口径**保持严格字面（`</final>` 不触发收束；实测无此症状，模型会补规范形式）——如要放宽属新裁定；④ 未测项：GUI 可视终确认（客户进行中）、`/plan/stream`、auto-exec、Windows。

## 0. 一句话背景

在真实项目（kanban-live 离场副本）上的首次完整链路测试证明：核心能力可用（T1/T2/T3 在带干预下全通；search 真实链路抽查全真；图谱 call_graph 11/9 + sequence_graph 9/8 实际产出），但**聊天管线在真实使用中基本不可用**——F1 使 17 次请求中 11 次「工具被静默丢弃」，**无干预完成率仅 2/6 段**。本次修复的目标即把「无干预全通」打通。

## 1. F1【高】同轮 `<final/>`/`<done/>` 抢占工具执行（核心行为修复）

- **现状（已核验）**：`agent.ts:913-918` 的终态检查先于 942-960 的工具执行并 `return`——同轮同时出现操作标签与终态标记时，**已解析的 operations 被静默丢弃**、无 `tools` 事件、`done.message` 为含原始标签的全文。
- **最小复现**：`POST /api/v1/agent/chat/stream`（mode=planner）发 T1 同款搜索指令 → 约 1 秒内 done、`tools_events=0`、message 含 `<read-file …>`（证据：attempt1 38 事件/1.4KB；成功对照 attempt4 5769 事件/205KB/110 工具操作）。
- **修复方向（选定：对齐既有 action 路径语义）**：同轮存在 operations 时——**先执行全部操作（发 `tools` 事件、结果回喂）并继续循环，该轮终态标记不生效**；模型在下一轮看到真实工具结果后再给出答复与收尾。理由：① `runActionStream` 的既有结构（「无操作时才判定终态」）就是该语义，T3 首试即过——两路径统一后维护面最小；② 「执行后立即结束」不可取：同轮 final 前的叙述是在**未看到工具结果**时写出的（可能含臆断），立即结束会把未经验证的文本当作最终答复。
- **`done.message` 清洗口径（本项一并统一）**：所有 `done` 的 message 一律取「**去除操作标签与终态标记后的正文**」——优先用 `parseXmlLike` 的正文（`agentMessage`，即标签间文字），解析失败时兜底 `fullText` 去 `<final/>`/`<done/>`；**PM handoff 分支同此口径**（顺带闭合 F4）。
- **归属**：agent-pipeline（`electron/server/services/agent.ts`）。
- **验收**：① **新增回归测试（必做）**：注入式假客户端（沿用既有私有无障碍测试模式）构造「操作标签 + `<final/>` 同轮」的流 → 断言 `tools` 事件产生、工具被真正执行、会话在看过结果后正常收束；并覆盖「无操作 + final ⇒ 直接 done」不回归；② §8 E2E 复跑对照；③ 既有 98/98 保持。

## 2. F2【中】对话历史角色映射按客户端真实协议修正（核心行为修复）

- **现状（已核验）**：`buildMessages` 仅把 `role==='agent'` 映射为 assistant，其余（含前端实发的 `'assistant'`）全部压为 user；ChatPanel 全程发 `role:'assistant'`（`ChatPanel.tsx` 106/293/302/323/331 等）→ 第二轮起模型把自己的历史答复当作用户输入（自导自演/复读；证据 `t2a-pm-turn2`）。
- **修复方向（选定）**：映射改为——`'assistant'` **或** `'agent'`（legacy 兼容保留）→ assistant；`'user'` → user；未知角色 → user（保持兜底）。核对 ChatPanel 发送协议一致性：其全部历史项均用 `'assistant'`，**前端无需改动**（仅以测试锁定该协议）。
- **归属**：agent-pipeline。
- **验收**：① **回归测试（必做）**：`'assistant'` 透传为 assistant、`'agent'` 兼容为 assistant、未知落 user；② E2E 复跑观察 PM 两轮对话无角色错位；③ 98/98 保持（既有用例更新后计数不变）。

## 3. F3【中】界面标签过滤（双层策略）

- **现状**：各组件渲染期 `cleanTags` 清单未覆盖 `<confirmed-requirement>`、`<handoff-to-planner/>`、`<skip-architect/>` 等标签；流式期间的**未闭合**标签（如半个 `<read-file …>`）也不在剥离范围——用户可见原始协议文本（E2E 留档可复现多数情形）。
- **修复方向（选定：双层）**：
  1. **渲染期扩展**：5 处既有清洗逻辑（`ChatPanel` / `PlanCard` / `ReviewCard` / `ActionDialog` / `ActionPanel` 的 cleanTags 类函数）统一补全标签集（上列三枚），并对**已知标签集**增加「未闭合/行内残留」剥离模式（按标签名精确匹配，避免误伤合法 HTML）。
  2. **完成期替换**：`ChatPanel` 在收到 `done` 时，用服务端清洗后的 `done.message`（口径见 F1）**替换该 agent 卡片累积的展示文本**；`streamSSE` 当前忽略 done，需把 done 数据传回调用方。
- **对用户流式过程的所见（明确）**：流式进行中仍可能**短暂**看到未闭合片段或未知标签（量少、时短）；本轮 `done` 到达即替换为干净文本——**终态零标签**。若客户要求流式全程零标签，可加码「onToken 点流剥离」（默认不采用：实现更碎、误伤面更大）。
- **归属**：agent-pipeline（5 个组件均在其 Section 1）。
- **验收**：① 用 E2E 留档中含标签的响应文本对清洗逻辑做样例核对（若采纳 O-F3 抽共享工具则加单测）；② E2E 复跑留档的最终文本零协议标签；③ 98/98 保持。

## 4. F4【低】PM handoff 的 done.message 残留 `<final/>`

- 随 F1 的清洗口径统一闭合（handoff 分支亦走「去操作标签与终态标记」）。**归属**：agent-pipeline。**验收**：单测覆盖（可并入 F1 测试文件）+ E2E 复跑核对。

## 5. F5【低】Mapper 图精度（提示词侧）

- **现状**：1/11 节点行号偏差（store.js:1 实为 103）；sequence 节点 label「[客户端]」与 lane「第三方」不一致。
- **修复方向（最小）**：`MAPPER_SYSTEM_PROMPT` 增加两条自检——① `line` 必须是函数/类的**定义行**（从 read-file 行号前缀核对）；② label 来源前缀须与 `lane`/`kind` 语义一致。
- **归属**：agent-pipeline（提示词在 `agent.ts`；图渲染组件无需改动）。
- **验收**：E2E 复跑抽样行号与 lane 一致性改善、JSON 解析不回归；**口径如实**：属 LLM 行为改善，验收为「改善 + 不回归」，不承诺每次 100%。

## 6. F6【低】Architect interfaces 空数组（提示词侧）

- **修复方向（最小）**：`ARCHITECT_SYSTEM_PROMPT` 补一句——「若模块之间存在跨模块调用，interfaces 至少给出这些调用的最小契约；确无跨模块调用时方可为空数组」。**归属**：agent-pipeline。**验收**：E2E 复跑观察输出结构（非硬性指标，如实报告）。

## 7. F7【低】调试打印清理（`app.log` 噪音）

- **现状**：`agent.ts` 约 828/832/837/841 行一带存在 `console.log('1222222'+req.mode)`、`console.log(systemPrompt)`、`console.log("2222222222"+…)`、`console.log(messages[0])` 等无意义前缀/整对象打印；E2E 的 app.log 达 378KB。
- **修复方向**：删除该批调试打印；保留结构化 `[processStream]` 系列与 NODE_ENV 门控的 `[PM Agent]` 等有排查价值的日志。**归属**：agent-pipeline。**验收**：grep 零命中该批打印；98/98 保持。

## 8. 批末验收（关键：E2E 前后对照）

全部落地后**复跑同一 E2E 测试**：同一靶副本（`/tmp/tracecrew-e2e/kanban-live-4`，源基线文件在）、**同一驱动脚本**、**无干预**执行 T1/T2/T3：
- **修复前基线**：无干预完成率 **2/6 段**；F1 命中 **11/17 请求**。
- **目标**：**无干预全通**；若仍有残余，如实报告原因与残余率。前后对照数据随最终报告提交。
- 由 project-test 主导复跑与独立报告；副本/源只读边界同前；不做 auto-exec。

## 9. 必选 / 选装

**本次必须做**：F1（含 done.message 口径统一 + 回归测试）、F2（含回归测试）、F3（双层 + 最小清单/替换）、F4（随 F1 口径）、F5（提示词两条自检）、F6（提示词一句）、F7（打印清理）、§8 复跑对照。

**选装**（默认勾选为建议，旁边标注待客户确认）：

- [x] O-F3：把 5 处重复的标签清洗逻辑抽为 agent-pipeline 的共享工具函数并加单测（清洗规则单点维护、F3 可测）。**（默认推荐，待客户确认）**
  好处：规则单点维护、有单测；不加则本次为 5 处同步改清单（也可接受）。
  代价：一次小重构 + 新文件路径需治理增补（或放既有组件内导出）。
- [x] O-F1a：E2E 复跑时额外加测一轮「同轮 `final` + **写类操作**（create-file）」于**临时副本**，验证 F1 语义对写路径同样正确（T3 仅覆盖了只读 explain）。**（默认推荐，待客户确认）**
  好处：写路径覆盖；代价：一次额外 E2E 轮次（少量 token）。

## 10. 实施顺序与节点（预计）

1. **E-F1（agent-pipeline）**：F1 + F2 + F4 + F5 + F6 + F7（均在 `agent.ts`，一个问题域一次改完）→ 回归测试（F1/F2 必做）+ 98/98 + `check:electron`=0。
2. **E-F2（agent-pipeline）**：F3 前端双层（5 组件 + O-F3 共享工具）→ 单测 + 98/98。与 E-F1 写集不相交（`agent.ts` vs 组件），可并行。
3. **E-F3（project-test）**：§8 E2E 复跑对照（无干预 + 追加写类轮次如 O-F1a 获批）+ 独立报告。
4. **E-F4（project-management）**：规则/记录收口与最终报告。

## 11. 未决问题

1. **O-F3 / O-F1a** 取舍；F3 流式期「短暂可见」是否接受（默认接受，见 §3）。
2. F5/F6 为 LLM 行为改善，验收按「改善 + 不回归」口径（不承诺每次 100%）。
3. GUI 可视终确认仍留客户（进行中）；`/plan/stream`、写入类 action、auto-exec 不在本次范围。

> 以上未决已在实施中收敛：O-F3 / O-F1a 均已实施；残余 1 已由 E-F1b 补正；残余 2/3 与「收束信号检测口径」观察入「实施结果」小节。
