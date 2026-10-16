---
id: design-chat-input-images-thinking
type: design
title: 聊天输入增强：① 图片发送 ② 思考强度选择——设计方案
created: "2026-10-16"
updated: "2026-10-16"
timezone: Asia/Shanghai
status: verified
related: [design-positioning-alignment]
events:
  - date: "2026-10-16"
    kind: created
    summary: 客户两项指令（聊天发图片 / 选择思考强度）；协调者已完成可行性探测（代理对 deepseek-chat 与 deepseek-reasoner 均接受 image_url 内容块且图像真实送入模型；reasoner 的 reasoning_content 可得）；完成全量面勘察（消息构造链/服务端假设点/模型配置/reasoning 链/2MB 限制）→ 合并为一份设计方案，呈客户确认后实施
  - date: "2026-10-16"
    kind: revised
    summary: 客户补充「low mid high 几个档位」→ ② 升级为三档；协调者实测矩阵（真实模型名/无 effort 生效/视觉交叉点）入档；**设计期三档对照小测完成**（同一真实问题：low 3.2s/516tok、mid 5.1s/774tok+CoT、high 35.8s/2170tok+CoT；真实截图视觉：low/mid ✓、**high（v4-pro）无视觉确证**）→ 定稿映射与默认档（中）、高档次×图片采用「自动降档+明示」默认策略；统一确认清单就绪
  - date: "2026-10-16"
    kind: revised
    summary: **机制再修正（协调者穷举实测，`reasoning_effort` 作废）**：三档=**同模型 `deepseek-v4-flash` + `thinking.type`**（disabled/adaptive/enabled）——非换模型；本上下文对照小测复核定稿（简单题三档 ~1s 级；难题 low 6.6s/1160tok/无CoT、mid 35.8s/6461tok/13.5k CoT、high 40.8s/7435tok/15.2k CoT；非法枚举被拒并自证枚举集）；**默认档建议=低**；**图片 × 三档全兼容（无降档问题）**；v4-pro 无视觉→不入档位（观察项）。统一确认清单 v2 就绪
  - date: "2026-10-16"
    kind: approved
    summary: 客户批准统一确认清单 4 项；**默认思考档=中（adaptive）**（客户指定，覆盖我方建议的「低」）——实现为**单常量**（便于日后调整）；图片 v1 取舍与控件形态按方案；提示文案由项目管理出稿（i18n 12 键已就位）。实施一批派发（agent-pipeline 主 + PM i18n + project-test 独立验证）；涉及 electron 主进程（routes/agent.ts、agent.ts）→「可复验」需重启应用
  - date: "2026-10-16"
    kind: verified
    summary: **批闭环**（I0–I2 + I-LX；记录 ../scheduling/chat-input-enhance.md）：三档（同模型+thinking 参数，默认=中单常量）+ 图片（三入口/压缩/parts 组装/8mb 上限）实施完成；四门槛 ×2 全绿（119/119）；**I-LX 独立验证通过**（契约探针 46/46〔含修正前 400 可复现〕、canvas 离屏真实压缩链、上限核算判定 8mb 为鲁棒性所需、隔离增量与零改动齐）；终审拦截修复 thinking 线格式契约不一致。未测：真实 API e2e（视觉问答/三档 CoT 实况）、GUI 目视（需重启）、断网恢复真机
---

# 聊天输入增强：① 图片发送 ② 思考强度选择——设计方案

> 状态：**已实施并通过独立验证（2026-10-16 闭环）**。两项特性共用同一改动面（ChatPanel / routes/agent.ts / agent.ts / i18n），合并为一份方案（含设计期实测与机制两轮修正史）。
> 可行性前提（协调者探测 + 本上下文复核，2026-10-16）：**客户配置模型本身（`deepseek-v4-flash`）经真实截图复核实证具备视觉**（1×1 探针 +184 tokens 答对颜色；本上下文真实 UI 截图完整读出徽章文字）；思考强度经代理 `thinking.type` 参数实现（同一模型三态：`adaptive / enabled / disabled`；`reasoning_content` 可得，与既有 reasoning 链吻合）。

## 1. 特性 ①：聊天发送图片

### 1.1 UX（三入口 + 缩略图 + 状态）
- **入口**：输入区支持 ① 剪贴板粘贴（Ctrl/⌘+V，`paste` 事件取 `clipboardData.items` 图片）；② 文件选择（隐藏 `<input type="file" accept="image/*" multiple>`，纯渲染层，**无需新 IPC**——勘察确认 preload 无图片 IPC，亦不需要）；③ 拖拽到输入区（`dragover/drop`）。
- **待发预览条**：输入区上方一行缩略图 chips（含体积标注与 ✕ 移除）；压缩中显示占位。
- **发送后**：用户气泡内展示缩略图（`kind:'user'` 条目新增 `images?: string[]`；渲染点 UserMsg CP:1065-1076）；发送中/失败状态如实（失败可移除重发；图片不落盘、不引用项目文件）。
- **v1 不做**：点击放大预览、图片注释、按路径引用项目内图片（后者才需要新 IPC，列为可选后续）。

### 1.2 数据流（主改动面）
```
ChatPanel（采集+压缩+预览）
  → 请求体新增可选字段 images?: string[]（data URLs；仅"本轮消息"携带）
  → routes/agent.ts 解析与校验（数量/体积/前缀）
  → processStream：组装时把【最后一条带图 user 消息】的 content 升级为
     OpenAI 兼容 parts 数组 [{type:'text',text}, {type:'image_url',image_url:{url}}]
```
- **前端**：`attachments` state；发送时 body `{history, mode, images?, thinking?}`（streamSSE CP:204 处扩展）；`kind:'user'` 条目加 `images`；历史推送保持字符串，文本中附「（附图 N 张）」标记（历史重发**不重发图片**——v1 取舍：省 token/体积；模型对旧图不再回看，如实记录）。
- **服务端改造点（勘察逐条）**：`buildMessages`（AS:772-792）content 类型升级为 `string | parts[]`；首条前 system unshift（AS:902-904）与其余注入消息（近限/纠偏/工具结果/续写提示，AS:926-1088 共 9 处）**保持字符串**不动；`.content.slice(0,100)` 日志（AS:908）加类型守卫；`truncate`（AS:794-798）仅作用于文本（现状本就只截工具结果）；前端三 ref 类型（CP:119-121）。
- **体积上限**：`express.json` 现为 **2MB**（IDX:17）——v1 **同时**：客户端总量 ≤1.2MB（编码后）+ 服务端上限提升至 8MB（本地服务，留余量）。

### 1.3 约束与压缩（数字）
| 项 | 值 | 说明 |
| --- | --- | --- |
| 客户端压缩 | canvas 下采样**最长边 ≤1400px**、JPEG q0.85（白底） | 保持截图文字可读 |
| 单图上限 | ≤ 500KB（编码后） | 超标二次降质 |
| 每消息数量 | ≤ 3 张 | chips 上限提示 |
| 消息总量 | ≤ 1.2MB（编码后） | 配合 8MB body 上限留余量 |
| 视觉 token | 每图约数百–千余 token（模型侧计费） | 如实告知：多图=更高成本与延迟 |

### 1.4 归属与验收
- **归属**：agent-pipeline（ChatPanel / routes/agent.ts / agent.ts）；i18n=项目管理；**app-shell 零改动**（无需 IPC）。
- **验收**：真实场景——粘贴一张报错截图问「这段报错怎么理解」→ 回答针对图中内容（API 驱动可复跑：含 1×1 或小图请求，断言模型引用图内容）；无图路径回归零变化（请求体与现行为逐字段一致）；四门槛 + project-test 独立验证 + 客户 GUI 目视。XML 工具协议不受影响（输入侧特性）。

## 2. 特性 ②：思考强度（low / mid / high 三档——同模型 + `thinking` 参数）

### 2.1 形态
- **方案 A（推荐）**：输入区**三档分段控件**「低 · 中 · 高」（档位副标见 2.4），会话内记忆（localStorage）；**默认档建议=低**（依据见 2.5）。切换处标注成本差异。
- **方案 B（不推荐，仅说明）**：只靠设置面板改模型——不直观、不满足"对话中选择"的客户语义；且本机制**不换模型**（见 2.2），设置面板模型项与档位无关。
- 设置面板保持现状。

### 2.2 机制与映射（协调者穷举实测 + 本上下文对照小测定稿，2026-10-16）
三档 = **同一模型 `deepseek-v4-flash`** + 顶层 `thinking` 参数（**不换模型**；`reasoning_effort` 为错误参数名、静默无效、**作废**）：

| 档 | thinking.type | 语义 | 简单题实测（1+1） | 难题实测（null.reduce 多角度防御分析） |
| --- | --- | --- | --- | --- |
| **low** | `disabled` | 不思考；系统模板最小化（prompt 15 tok） | 0.7s / +1 tok / 无思维链，答对 | **6.6s / 1160 tok / 无思维链，答对** |
| **mid** | `adaptive` | 按需思考（简单题轻、难题自行加深） | 0.9s / +37 tok / 思维链 118 字符 | 35.8s / 6461 tok / **思维链 13,480 字符**（按需变深、无上限） |
| **high** | `enabled` | 强制思考 | 1.0s / +30 tok / 思维链 105 字符 | 40.8s / 7435 tok / 思维链 15,185 字符 |

- **合法枚举自证**：非法值被代理拒绝——本上下文探针 `thinking.type='bogus-value'` → HTTP 500 +「expected one of `adaptive`, `enabled`, `disabled`」；**服务端按严格枚举校验并在自身层先行 400**（比代理 500 更干净）。
- **图片 × 三档全兼容**：三档同模型（`deepseek-v4-flash`，视觉已验证）——**无降档问题**；`deepseek-v4-pro`（实测无视觉）**不入档位**，记为观察项。
- **缺省行为**：缺省=低 将显式携带 `thinking:{"type":"disabled"}`（现状请求未发该参数；回归时按「无参数 vs disabled」对照一次确认等价）。

### 2.3 数据流
- 请求体新增 `thinking?: { type: 'adaptive' | 'enabled' | 'disabled' }`（严格枚举；未知值服务端 400）。
- 服务端**透传**至代理（`getModel` 不动）；v1 作用范围=该请求整链（含 PM 咨询派发链，行为一致）。

### 2.4 呈现（含两处既有小缺陷修复）
- 档位控件=三档分段控件（会话记忆）；副标建议：低=「极速」、中=「自适应」、高=「深度思考」。
- mid/high 卡片展示「思考过程」折叠区（复用既有 reasoning 渲染链）；`pmStream` 补接 `onReasoning`（CP:312-321 现未接 → PM 卡丢弃思维链）；「思考过程」硬编码中文（CP:1089）→ i18n `chat.reasoning`；新增 `chat.thinkingLow/Mid/High`（项目管理，4 语言包）。

### 2.5 成本/延迟与默认档（实测依据）
- 简单题：三档均 ~1s 级（差价 ≤0.3s）。
- 难题：low 6.6s vs mid 35.8s vs high 40.8s（+29~34s；输出 +5.3~6.3k tok；思维链 +13.5~15.2k 字符）——**adaptive 在难题上会自行加深且无上限**，成本不可预期是其主要特征。
- **默认档建议=低**：延迟/成本可预期、与现状体验一致、难题也以 6.6s 给出正确答案；需要深度时一键切中/高。（客户可指定默认=中，偏好"自动按需思考"。）

### 2.6 验收
- API 驱动：三档各发同题（简单+难题）→ 断言 `thinking` 参数生效（低档无 `reasoning` 事件、中/高有）与模型不变；非法枚举 → 服务端 400；「无参数 vs disabled」对照；图片×三档交互（均可得视觉）；四门槛 + project-test 独立验证 + 客户 GUI 目视（分段控件、副标、思考过程折叠）。

## 3. 实施建议与归属

- **一批实施**（两特性同文件面）：同一 agent-pipeline 上下文按序（①→②）落两特性，减少接口过渡；i18n 由项目管理随批清理/新增；完成后 project-test 独立验证（API 驱动 + 隔离审计）；全程不提交 git。
- 触点小结：CP（采集/预览/条目/渲染/切换/请求体）、RT（解析校验）、AS（parts 组装/类型/mode override/reasoning 接线）、SP（无需动，除非后续把"默认强度"放设置）、i18n（4 键 ×4 包 + 清理）。量级 **M**。

## 4. 统一确认清单（呈客户一次确认）

1. **三档机制与映射**：**同模型 `deepseek-v4-flash` + `thinking.type`**（低=`disabled` / 中=`adaptive` / 高=`enabled`；实测见 §2.2/§2.5）——**默认档建议=低**（延迟/成本可预期、与现状一致；客户可指定为「中」）；
2. **图片 × 三档全兼容**（同模型有视觉，**无降档问题**）；`deepseek-v4-pro`（实测无视觉）不入档位，记为观察项；
3. **图片 v1 取舍**：历史轮不重发、≤3 张/条、单图 ≤500KB、最长边 ≤1400px、总量 ≤1.2MB；本地 body 上限 2MB→8MB；
4. 档位默认值**不加**设置面板（v1：输入区三档控件 + 会话记忆）；提示文案由项目管理出稿（随 i18n 落地）。
（原「快速档模型口径」「高低档模型映射」「降档策略」等项随机制定稿自然消解。）
