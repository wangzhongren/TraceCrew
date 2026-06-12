# TraceCrew

A multi-agent collaborative IDE for code intelligence. A structured agent crew (Planner → Reviewer → Mapper) replaces the single-agent paradigm — achieving large-model quality code understanding and modification with a team of smaller, specialized models. An interactive call graph serves as the operating map: right-click any node to fix, refactor, test, or explain.

> *Single agent has a ceiling. A crew doesn't.*

## Core Idea

```
Single Large Agent:                       TraceCrew (Multi-Agent Crew):

Claude Opus ──── read/write files         Planner ───── architecture analysis (narrow context)
  │  ──── understand architecture          │
  │  ──── search codebase         Reviewer ──── evidence verification (checks & balances)
  │  ──── write changes                    │
  │  ──── verify impact           Mapper ────── call-chain tracing (pattern matching)
  │                                       │
  └─ one brain does everything    Executor ───── execute operations (ultra-narrow context)

Token cost: $$$$                        Token cost: $
Role confusion, no oversight            Clear division of labor, structured validation
Linear execution, no parallelism         Graph naturally shows impact scope
```

Each agent has a distinct responsibility, a tailored system prompt, and structured I/O (JSON). The Planner only needs to understand architecture. The Mapper only needs to trace call chains. The Executor only sees the current node's context. Small models in narrow domains perform close to large models — at a fraction of the cost.

## Interface

```
┌──────────────────────────────────────────────────────────────────┐
│                        Title Bar                                  │
├──────────────────────┬───────────────────────────────────────────┤
│                      │                                           │
│    Chat Panel        │        Mapper View (Call Graph)           │
│                      │                                           │
│  Planner             │  ┌─ TitleBar.tsx ───────────────────┐    │
│    ↓                 │  │ onClick → action('close')          │    │
│  Reviewer            │  └────────────┬──────────────────────┘    │
│    ↓ (pass)          │               │ IPC invoke                 │
│  Mapper              │  ┌────────────▼──────────────────────┐    │
│                      │  │ ipcMain.handle('window:close')    │    │
│  ↻ retry on fail    │  │ 🔴 calls app.quit() — skips      │    │
│                      │  │    lifecycle hooks                │    │
│  PlanCard            │  └───────────────────────────────────┘    │
│  ReviewCard          │                                           │
│                      │  Right-click node → Fix/Refactor/Test     │
│  [input] [Send]      │  Drag / Zoom / Expand nodes               │
│                      │                                           │
└──────────────────────┴───────────────────────────────────────────┘
```

## Agent Crew

| Agent | Role | Responsibility |
|-------|------|----------------|
| **Planner** | Architect | Analyzes requirements, explores codebase, outputs structured execution plan |
| **Reviewer** | Inspector | Verifies Planner's analysis against code evidence — pass or send back |
| **Mapper** | Cartographer | Traces call chains, draws annotated call graph with change locations |

**Flow**: `User Input → Planner → Reviewer → Mapper`
- Planner reads code, produces structured plan and key file list
- Reviewer validates the plan against real code → pass / reject with feedback ↻
- Mapper traces relevant call chains, draws annotated graph (only after plan approval)
- Right-click any node on the graph to execute operations (fix, refactor, test, explain) via SSE streaming

### Call Graph Node States

- ◈ **existing** — current code, no changes
- ✕ **problem** — issue detected, needs fixing
- △ **planned_change** — scheduled modification
- \+ **planned_new** — new addition

Each node shows: source prefix ([frontend]/[backend]/[IPC]), file path, line number, status description. Edges show call relationships with labels, including curved arcs for back-edges.

## Features

- **Multi-Agent Crew** — Planner → Reviewer → Mapper structured pipeline with `<final/>` explicit completion
- **Graph-Based Operations** — Right-click nodes directly on the call graph to trigger fix/refactor/test/explain/develop, streamed via SSE
- **Server-Side Tool Execution** — All LLM tools (read, write, search, shell) executed by backend, single request per agent
- **Semantic File Indexing** — Async summarization after each `read_file`, cached to SQLite, injected into future context
- **Code Viewer** — Click a node to open source file, auto-scrolled to function definition line
- **Resizable Panels** — ChatPanel, MapperView, and CodeViewer widths all adjustable via drag handles
- **Dark Theme** — GitHub-inspired design system with CSS three-layer token architecture
- **Custom Title Bar** — Frameless window with native controls

## Tech Stack

- **Frontend**: Electron, React 19, TypeScript, Tailwind CSS, Vite 6, dagre
- **Backend**: Express (embedded in Electron main process), better-sqlite3, OpenAI SDK
- **Build**: vite-plugin-electron

Everything runs in a single Electron application — no external processes.

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

Or configure via the ⚙️ settings button in the toolbar.

### Run

```bash
cd frontend
npm run electron:dev
```

Windows users: double-click `start.bat`.

## Project Data

| Path | Purpose |
|------|---------|
| `.tracecrew/tracecrew.db` | SQLite database (file summaries, change queue) |
| `.tracecrew/backups/` | File backups before edits (with meta.json) |
| `.tracecrew-logs/` | Shell execution logs |

## License

Apache License, Version 2.0. See [LICENSE](LICENSE).

Copyright 2026 wangzhongren
