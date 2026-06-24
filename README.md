# <img src="icon.png" alt="TraceCrew" width="32" height="32" style="vertical-align: middle;" /> TraceCrew

A multi-agent collaborative IDE for code intelligence. A structured agent crew (Planner → Reviewer → Mapper) replaces the single-agent paradigm — achieving large-model quality code understanding and modification with a team of smaller, specialized models. A **Kanban task board** serves as the operating map: plan tasks, execute automatically in dependency order, and review results.

> *Single agent has a ceiling. A crew doesn't.*

## Core Idea

```
Single Large Agent:                       TraceCrew (Multi-Agent Crew):

Claude Opus ──── read/write files         Planner ───── architecture analysis (narrow context)
  │  ──── understand architecture          │
  │  ──── search codebase         Reviewer ──── evidence verification (checks & balances)
  │  ──── write changes                    │
  │  ──── verify impact           Mapper ────── task planning & dependency ordering
  │                                       │
  └─ one brain does everything    Executor ───── execute operations (ultra-narrow context)

Token cost: $$$$                        Token cost: $
Role confusion, no oversight            Clear division of labor, structured validation
```

## Interface

```
┌──────────────────────┬───────────────────────────────────────────┐
│                      │                                           │
│    Chat Panel        │        Kanban Task Board                  │
│                      │                                           │
│  Planner             │  ┌─ 待开始 ────┬── 进行中 ──┬── 完成 ──┐ │
│    ↓                 │  │             │             │           │ │
│  Reviewer            │  │ [后端] IPC  │ [项目] 环境 │ ✅ 完成   │ │
│    ↓ (pass)          │  │ handler     │ 搭建        │           │ │
│  Mapper              │  │ [开发]      │ ⏳ 执行中   │           │ │
│                      │  │             │             │           │ │
│  ↻ retry on fail    │  │ [前端] 通知 │             │           │ │
│                      │  │ 弹窗组件    │             │           │ │
│  PlanCard            │  │             │             │           │ │
│  ReviewCard          │  └─────────────┴─────────────┴───────────┘ │
│                      │                                           │
│  [input] [Send]      │  [▶ 一键执行]  [全部|问题|待改|新增]      │
│                      │                                           │
└──────────────────────┴───────────────────────────────────────────┘
```

## Agent Crew

| Agent | Role | Responsibility |
|-------|------|----------------|
| **Planner** | Architect | Analyzes requirements, explores codebase, outputs structured execution plan |
| **Reviewer** | Inspector | Verifies Planner's analysis against code evidence — pass or send back |
| **Mapper** | Cartographer | Plans task dependencies, produces call graph nodes and edges for the Kanban board |

**Flow**: `User Input → Planner → Reviewer → Mapper → Kanban Board → Auto-exec or Manual`
- Planner reads code, produces structured plan and key file list
- Reviewer validates the plan against real code → pass / reject with feedback ↻
- Mapper produces task nodes with dependencies (only after plan approval)
- Tasks appear on the Kanban board: **待开始 | 进行中 | 完成**
- Click any pending card to **开发/测试/修复/解释**, or click **▶ 一键执行** to run all in order

### Task Node States

- ◉ **planned_new** — new task to develop
- ✕ **problem** — issue detected, needs fixing
- ✎ **planned_change** — scheduled modification
- ✓ **done** — completed

Each node shows: source prefix ([前端]/[后端]/[项目]), file path, Planner's analysis detail. Dependencies are automatically resolved — a blocked task shows "⏳ 等待依赖".

## Features

- **Multi-Agent Crew** — Planner → Reviewer → Mapper structured pipeline
- **Kanban Task Board** — Three-column layout (pending / active / done), with status filters
- **One-Click Auto-Exec** — `▶ 一键执行` button: topological sort → execute all tasks in dependency order → auto-advance on completion, stop anytime
- **Per-Node Action Streaming** — SSE streaming for develop/fix/refactor/test/explain, with real-time output and review pass/fail
- **Live Output** — Expanded card shows real-time agent output (XML tags stripped)
- **Execution Records** — Review results (pass/fail, feedback, issues) saved per node, expandable in card
- **Task Log** — `.tracecrew/TASKLOG.md` append-only log of completed tasks for context passing
- **Plan Persistence** — Approved Planner reports saved to `.tracecrew/PLAN.md`, survives restarts
- **Code Viewer** — Click card → right panel shows source file at function definition line
- **Markdown Rendering** — Planner analysis and agent output rendered via `marked`
- **JSON Lines SSE** — Backend streams `JSON.stringify(ev) + '\n'`, frontend `JSON.parse(line)`
- **Reasoning Display** — LLM reasoning tokens shown in collapsible "💭 思考过程" section
- **Resizable Panels** — ChatPanel, KanbanBoard, and CodeViewer widths all adjustable
- **Custom Title Bar** — Frameless window with native controls
- **i18n** — Chinese, English, Japanese, Korean

## Tech Stack

- **Frontend**: Electron, React 19, TypeScript, Tailwind CSS, Vite 6, marked
- **Backend**: Express (embedded in Electron main process), better-sqlite3, OpenAI SDK
- **Build**: vite-plugin-electron

## Quick Start

### Prerequisites

- Node.js 20+

### Setup

```bash
git clone https://github.com/wangzhongren/TraceCrew.git
cd TraceCrew/frontend
npm install
```

### Configure LLM

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

```env
TRACECREW_LLM_API_KEY=sk-...
TRACECREW_LLM_BASE_URL=https://api.openai.com/v1
TRACECREW_LLM_MODEL=gpt-4o
```

### Run

```bash
cd frontend
npm run electron:dev
```

## Project Data

| Path | Purpose |
|------|---------|
| `.tracecrew/tracecrew.db` | SQLite database (file summaries, change queue) |
| `.tracecrew/TASKLOG.md` | Append-only task completion log for context passing |
| `.tracecrew/PLAN.md` | Approved Planner report, survives restarts |
| `.tracecrew/backups/` | File backups before edits (with meta.json) |
| `.tracecrew-logs/` | Shell execution logs |

## License

Apache License, Version 2.0. See [LICENSE](LICENSE).

Copyright 2026 wangzhongren
