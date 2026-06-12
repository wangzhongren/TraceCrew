# TraceCrew

多 Agent 协作的代码智能 IDE。一个结构化的 Agent 团队（Planner → Reviewer → Mapper）替代单一 Agent，用小模型组合达到大模型级别的代码理解和修改效果。交互式调用图作为作战地图，直接在节点上发起修复、重构、测试等操作。

> *Single agent has a ceiling. A crew doesn't.*

## 核心理念

```
大模型单 Agent:                          TraceCrew (多 Agent 团队):
                                       
Claude Opus ─── 读写文件                Planner ───── 架构分析 (窄上下文)
  │  ─── 理解架构                        │
  │  ─── 搜索代码               Reviewer ──── 事实验证 (制衡)
  │  ─── 修改代码                        │
  │  ─── 验证影响               Mapper ────── 调用追踪 (模式匹配)
  │                                    │
  └─ 一个脑子做所有事               Executor ──── 执行操作 (极窄上下文)

Token 成本: $$$$                     Token 成本: $
角色混淆，无制衡                     分工明确，结构化验证
线性推进，无并行                      图天然展示影响范围
```

每个 Agent 职责边界清晰，系统 prompt 不同，输入输出结构化（JSON）。Planner 只需要懂架构，Mapper 只需要会追踪调用链，Executor 只看到当前节点上下文——小模型在窄领域跟大模型差距不大，但成本差一个数量级。

## 界面

```
┌──────────────────────────────────────────────────────────────────┐
│                        Title Bar                                  │
├──────────────────────┬───────────────────────────────────────────┤
│                      │                                           │
│    Chat Panel        │        Mapper View (调用图)               │
│                      │                                           │
│  Planner             │  ┌─ TitleBar.tsx ───────────────────┐    │
│    ↓                 │  │ onClick → action('close')          │    │
│  Reviewer            │  └────────────┬──────────────────────┘    │
│    ↓ (pass)          │               │ IPC invoke                 │
│  Mapper              │  ┌────────────▼──────────────────────┐    │
│                      │  │ ipcMain.handle('window:close')    │    │
│  ↻ retry on fail    │  │ 🔴 调用 app.quit() 跳过生命周期  │    │
│                      │  └───────────────────────────────────┘    │
│  PlanCard            │                                           │
│  ReviewCard          │  右键节点 → 修复/重构/测试/解释            │
│                      │  拖拽 / 缩放 / 节点展开                    │
│  [input] [Send]      │                                           │
│                      │                                           │
└──────────────────────┴───────────────────────────────────────────┘
```

## Agent 团队

| Agent | 角色 | 做什么 |
|-------|------|--------|
| **Planner** | 架构师 | 分析需求，探索代码库，输出结构化执行计划 |
| **Reviewer** | 审查员 | 事实验证 Planner 的分析，与代码证据对照，通过或驳回 |
| **Mapper** | 制图师 | 追踪调用链，绘制标注调用图（调用关系 + 变更位置） |

**流程**: `用户输入 → Planner → Reviewer → Mapper`
- Planner 读取代码，产出结构化计划和关键文件列表
- Reviewer 验证计划与实际代码是否一致 → 通过 / 驳回重来 ↻
- Mapper 追踪调用链，绘制带节点状态标注的调用图
- 图上右键节点执行操作（修复、重构、测试、解释），SSE 流式执行

### 调用图节点状态

- ◈ **existing** — 现有代码，无变更
- ✕ **problem** — 问题节点，需要修复
- △ **planned_change** — 待修改
- \+ **planned_new** — 新增

每个节点显示：来源前缀（[前端]/[后端]/[IPC]）、文件路径、行号、状态描述。边标注调用关系，支持回环边的弧形渲染。

## 功能

- **多 Agent 团队** — Planner → Reviewer → Mapper 结构化流水线，`<final/>` 显式完成
- **调用图作战** — 图上右键节点直接发起操作（修复/重构/测试/解释/开发），SSE 流式执行
- **服务端工具执行** — LLM 工具（读写、搜索、shell）全部由后端执行，单次请求即完成
- **文件语义索引** — 每次 `read_file` 后异步摘要，缓存到 SQLite，注入未来上下文
- **Code Viewer** — 点击节点查看源码，自动滚动到函数定义行
- **可拖拽面板** — ChatPanel、MapperView、CodeViewer 宽度均可调节
- **暗色主题** — GitHub 风格设计系统，CSS 三层 token 体系
- **自定义标题栏** — 无框窗口 + 原生控件

## 技术栈

- **前端**: Electron, React 19, TypeScript, Tailwind CSS, Vite 6, dagre
- **后端**: Express（嵌入 Electron 主进程）, better-sqlite3, OpenAI SDK
- **构建**: vite-plugin-electron

一切运行在单 Electron 应用内，无外部进程。

## 快速开始

### 环境要求

- Node.js 20+

### 安装

```bash
git clone https://github.com/wangzhongren/TraceCrew.git
cd TraceCrew/frontend
npm install
```

### 配置 LLM

在项目根目录创建 `.env`：

```bash
cp .env.example .env
```

```env
TRACECREW_LLM_API_KEY=sk-...
TRACECREW_LLM_BASE_URL=https://api.openai.com/v1
TRACECREW_LLM_MODEL=gpt-4o
```

也可以通过界面右上角 ⚙️ 设置按钮配置。

### 运行

```bash
cd frontend
npm run electron:dev
```

Windows 用户双击 `start.bat`。

## 项目数据

| 路径 | 说明 |
|------|------|
| `.tracecrew/tracecrew.db` | SQLite 数据库（文件摘要、变更队列） |
| `.tracecrew/backups/` | 文件编辑前的备份（含 meta.json） |
| `.tracecrew-logs/` | Shell 执行日志 |

## License

Apache License, Version 2.0. See [LICENSE](LICENSE).

Copyright 2026 wangzhongren
