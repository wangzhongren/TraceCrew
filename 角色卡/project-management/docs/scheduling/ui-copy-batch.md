# 调度记录 — ui-copy-batch（README 配图 + 「任务进度」移除 + 输入框占位文案）

> 单写者：项目管理上下文（手工维护）。planRevision: 1
> 来源：客户三项直接指令（A README 配图「readme.md 修改添加图片」；B「已完成任务这个 去掉，现在没有任务这个概念了」；C 输入框占位文案随定位收敛为讲解/解释）。**全程零 git 提交**（R14）。

## 1. 节点表

| 节点 | 角色 | 交付物 | 写入范围 | 前置 | 状态 |
| --- | --- | --- | --- | --- | --- |
| R1 | project-management | A① README Interface 节嵌入 `docs/images/ui-overview.png` + caption/说明文案 | `README.md` | — | **verified**（本上下文；相对路径引用；ASCII 结构图保留） |
| R2 | project-management | C `chat.inputPlaceholder` 四语言改稿（构建/修复 → 提问/讲解） | `src/i18n/*.json` | — | **verified**（128/128 键一致、可解析；窗口截图实证 HMR 后新文案已显示） |
| R3 | agent-pipeline | B 移除 ChatPanel 恢复链「任务进度/待完成」构造块（原 195–203 行） | `ChatPanel.tsx` | — | **verified**（attempt 1：−9/+0；全域 grep「任务进度\|个任务」零残留；i18n 无对应键；门槛 tsc=0、npm test 119/119、build=0、check:electron=0；哈希 `8cb37f1f…`；本上下文复核 tsc=0、119/119、哈希逐字一致） |
| R4 | project-management | 「任务」概念残留普查清单（呈客户定夺） | 调查（只读） | — | **verified**（只读普查完成：A/B/C/D 共 16 项 + README 参考 7 处，见 §5；未擅动任何项） |
| R5 | project-management | A② 建议截图场景清单（呈协调者转客户） | 本文档 §3 | — | **verified**（本上下文） |
| R6 | project-management | 客户确认实施：i18n 7 键改稿 + 2 孤儿键删除（A1/B9）× 4 语言包；README 4 处口径同步 | `src/i18n/*.json`、`README.md` | 客户确认 | **verified**（126/126/126/126 键一致、parse OK；README 仅剩 3 处保留项〔L68/L89 术语、L205 机制名〕；i18n 全域「任务/task/タスク/작업」零残留） |
| R7 | graph-view | B1：MapperView tab「任务依赖」→「依赖关系」 | `MapperView.tsx` | 客户确认 | **verified**（+1/−1；tsc=0、npm test 119/119、build=0；哈希 `24e924e7…`） |
| R8 | agent-pipeline | A2 回报模板「已完成本轮咨询」+ D3「修复文件：」→「涉及文件：」 | `ChatPanel.tsx`、`ActionPanel.tsx` | 客户确认 | **verified**（各 +1/−1；四门槛全绿含 check:electron=0；哈希 `4e3a4c68…`/`ee4b4489…`） |
| R9 | project-management | 核验：grep 零残留 + 四门槛 + HMR 目检 | — | R6–R8 | **verified**（grep 零残留、四门槛全绿〔tsc=0、**119/119**、build=0、check:electron=0〕；协调者重启后目视复核通过——fresh load 下 i18n 渲染全正常、分裂态解除〔seq 7〕；新文案完整目视需打开项目，留协调者/客户） |
| R10 | agent-pipeline | B2 轻改：恢复注入串 `[任务节点]`→`[节点]` | `ChatPanel.tsx` | 客户确认（对账） | **verified**（+1/−1；`grep 任务节点`零、`[节点]` 命中 1；tsc=0、npm test 119/119、build=0；哈希 `5921d08b…`） |

## 2. 事件历史

| seq | 时间 | 事件 kind | 节点 | 摘要 |
| --- | --- | --- | --- | --- |
| 1 | 2026-10-16 | assigned | R1–R5 | 第三任上下文接管，客户三项待办立项；R1/R2 本上下文即时执行；R3 派 agent-pipeline（前置线索＝ChatPanel.tsx:198/201 构造串，实为应用恢复会话时自拼消息、非模型回显）；R4 派只读普查（「任务」概念与「构建/修复」文案全域） |
| 2 | 2026-10-16 | verification-passed | R3 | agent-pipeline 完成 −9/+0 并自证；本上下文复核：改动区代码干净（`summary` 直 join 余项、保留面完整）、哈希 `8cb37f1f…` 逐字一致、tsc=0、npm test **119/119**（最新树，含 R2 改动）、截图确认 HMR 后界面渲染正常 |
| 3 | 2026-10-16 | delivered | R1/R2/R5 | README 配图嵌入完成（Interface 节）；占位文案四语言生效（窗口实证「问我代码问题，或描述想讲解的流程...」）；截图场景清单出稿（§3） |
| 4 | 2026-10-16 | closed | R1–R5 | **批闭环**：R4 普查清单产出（见 §5；呈客户定夺项未擅动）；本记录与 memo 更新。未测项如实：B 的恢复场景目视（需重启或切到有保存计划的项目；当前客户实例为空态会话）留客户 |
| 5 | 2026-10-16 | assigned | R6–R9 | **客户确认到达**（清单全采纳：13 处文案/2 键删除/README 4 处同步，C 组保持）→ 派发：R6 本上下文（i18n+README）、R7 graph-view、R8 agent-pipeline；实施完成并核验（grep 零残留、四门槛全绿） |
| 6 | 2026-10-16 | blocked | R9 | **HMR 目检受阻**：批量编辑 i18n JSON 触发 vite 对 `i18n/index.tsx` 的 reload 兜底链（日志 10:53–11:01 实证），尾部孤立 update 致运行窗口落入 Context 分裂态（部分组件渲染键名）；判定**非代码缺陷**（构建/测试全绿、vite 模块正确、10:53:14 reload 后曾实测正常）→ **请协调者对窗口一次刷新/重启即恢复**，恢复后目视新文案 |
| 7 | 2026-10-16 | verification-passed | R9/R10 | **B2 轻改落地**（客户对账后指派：`[任务节点]`→`[节点]`，+1/−1，哈希 `5921d08b…`，门槛全绿）。协调者重启应用（新实例）→ **目视复核通过**：fresh load 下 i18n 全正常（「未选择项目/打开文件夹」等均为译文、无键名），分裂态解除；B2 经 HMR 进入新实例无异常（抓图佐证）。**R9 完整闭环，普查批（R6–R10）全链完成**。新文案完整目视（打开项目后的空态三处 + B 恢复场景）留协调者/客户 |

## 3. A② 建议截图场景清单（呈客户摆场景 → 协调者抓拍 → 本角色收入排版）

1. **全景主图（建议重抓，覆盖 `docs/images/ui-overview.png` 同路径）**
   - 展示：重启恢复后的完整工作台——Planner 卡（上次计划/步骤/分析报告）+ 时序图 + 待改列表 + 输入区三档控件（B 落地后的新形态）。
   - 操作：重启应用 → 打开有已保存计划的项目（如 dai-kai-kefu）→ 等恢复卡片渲染完 → 抓全窗口。
2. **讲完即画（Explain-Then-Draw）**
   - 展示：核心链路——提问 → PM 讲解 → 自动派 Mapper → 画布出调用图（派发提示同屏）。
   - 操作：切到调用图 tab（可选）→ 输入「〈某流程〉怎么走」→ 等讲解结束、画布出图 → 抓「讲解尾部 + 调用图 + 派发提示」同屏。
3. **节点「解释」导出**
   - 展示：待改列表节点卡的「解释」动作 → 生成该节点 Markdown 并提示「已导出到 .tracecrew/explanations/」。
   - 操作：点任一节点卡「解释」→ 等导出提示出现 → 抓待改列表 + 提示。
4. **图片问答 + 思考强度**
   - 展示：粘贴截图提问（缩略图在输入区）+ 三档思考强度（如选「高」）+ 回答针对图中内容。
   - 操作：粘贴一张报错截图 → 输入「这段报错怎么理解」→ 点「高」档 → 发送 → 抓「缩略图 + 高亮档位 + 回答」。

## 4. 观察项

- R3 边缘态：仅 `savedGraph` 无 `savedPlan` 时，restore 聊天消息文本为空串（timeline 条目与 history 注入仍照常）——计划与图一般同存，罕见；如需处理另行提案（呈客户知悉）。
- `docs/images/ui-overview.png` 抓取时含「任务进度」块（B 落地前界面）；建议按 §3 第 1 项重抓覆盖同路径（README 无需改动）。
- 空态仍有旧概念文案（「描述你的任务」「生成任务看板」等，见 §5 普查结果），未擅动，呈客户定夺。**（2026-10-16 更新：客户已全采纳，R6–R8 已实施核验——见节点表与 §2 seq 5–6。）**
- **HMR 边缘（非代码缺陷，R8 实施后定位）**：批量编辑 `i18n/*.json` 时，vite 会因 `i18n/index.tsx` 混合导出（`LOCALE_LABELS` 常量）判定不可 Fast Refresh（`hmr invalidate`）→ 以 `page reload` 兜底（dev 日志 10:53–11:01 多次实证）；多轮快速保存的**尾部孤立 update**（无 invalidate/reload）会使运行中窗口落入 Context 分裂态——部分组件（走 i18n 的）渲染键名、部分正常。**证据**：vite 服务模块内容正确（curl）、构建/测试全绿、10:53:14 reload 后曾实测正常（22:53 窗口截图）。**恢复**：对窗口一次刷新（Cmd+R）或重启，无数据影响。**防复发（可选，待客户定夺）**：将常量导出与组件拆分（如 `LOCALE_LABELS` 移出 index.tsx），或接受「批量改 i18n 后刷新一次」的惯例。

## 5. R4 普查清单（「任务」概念残留，呈客户定夺；16 项 + README 参考）

> 口径：只列不改。i18n 键四语言同行号且已对齐，仅注差异。每项附本角色建议供客户勾选。

**A · 与「任务进度」同族（2 项）**
- A1 `chat.toolOperations`（i18n:37；ko「{count}개의 도구 작업」；zh/en/ja 无关键词）——**孤儿键**（代码零引用）。建议：删键（零风险）。
- A2 `ChatPanel.tsx:1042` 硬编码「【系统回报】…已完成当前咨询任务。产出摘要…」——注入 LLM 会话的回报模板（非直接渲染）。建议：轻改去掉「任务」二字（如「已完成本轮咨询」）。

**B · 图谱「任务依赖/任务节点」类（9 项）**
- B1 `MapperView.tsx:338` 硬编码 tab「任务依赖」——建议：改「依赖关系」（与「调用图/时序图」并列）。
- B2 `ChatPanel.tsx:206` 「[任务节点]」——恢复会话时注入 LLM 历史（用户不可见）。建议：保持或轻改。
- B3 `graph.callGraph`（i18n:70）「任务看板」（en "Task Board"）——画布标题。建议：改「图谱」（en "Graph"）等。
- B4 `graph.emptyHint`（i18n:66）「在右侧聊天面板描述任务，Agent 将自动生成任务看板」——画布空态。建议：随 B3 口径。
- B5 `graph.analyzing`（i18n:67）「Planner 正在规划任务，即将生成任务看板...」——建议：随 B3。
- B6 `graph.processing`（i18n:68）「Agent 正在处理中，任务看板即将生成...」——建议：随 B3。
- B7 `graph.noGraph`（i18n:69）「暂无任务」——建议：改「暂无图谱」。
- B8 `graph.emptyAction`（i18n:71）「PM → … → 生成任务看板」——建议：随 B3。
- B9 `graph.callChain`（i18n:72）「任务列表」（en "Tasks"）——**孤儿键**。建议：删键。

**C · 节点状态词（2 项，建议保持）**
- C1 `graph.completed`（i18n:60）「已完成」——画布左下状态**图例**（「已完成 (N)」；节点徽章文案在 `types/theme.ts` STATUS_LABELS，不含关键词）。建议：保持（节点状态语义，非任务概念）。
- C2 `graph.problemToFix`（i18n:58）「问题/待修复」——同图例项，含「修复」族字样。建议：保持，或与修复族一并议。

**D · 其他（3 项）**
- D1 `chat.inputPlaceholder`（i18n:15）——**已处置**（本批 C 项：四语言已改「问我代码问题/讲解流程」口径）。
- D2 `chat.describeTask`（i18n:13）「描述你的任务」——聊天空态标题。建议：改「问我代码问题」等（与 D1 口径统一）。
- D3 `ActionPanel.tsx:252` 硬编码「修复文件：」——影响范围卡片标签（同卡「影响节点：」「验证：」）。建议：改「涉及文件：」。

**README 参考（7 处，本角色白名单，未擅动）**
- L16 "Mapper — task graph & sequence diagram"；L37 ASCII「🔀任务依赖」；L68/L89 "task dependency graph"（图论标准术语）；L72 "Task Node States" 小节；L76 "New task to implement"；L205 `.tracecrew/TASKLOG.md`（**真实机制**：`electron/fileManager.ts` 仍在写入）。建议：L16/L37/L72/L76 可随 UI 口径一并调整；L68/L89 术语可保留；L205 保持（机制名）。

小计：A=2、B=9、C=2、D=3（共 16；D1 已处置）；孤儿键 2 个（A1/B9）。以上全部未擅动，待客户定夺后按归属派发。
