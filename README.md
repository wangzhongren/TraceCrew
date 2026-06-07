# CodeAtlas

AI-powered code exploration and editing IDE. Natural language driven, with a 4-agent pipeline that plans, maps, executes, and reviews code changes — all visualized as an interactive call graph.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      Title Bar                               │
├─────────────────────┬────────────────────────────────────────┤
│                     │                                        │
│    Chat Panel       │        Call Graph Canvas               │
│                     │                                        │
│  Planner            │     ┌──────────┐                       │
│    ↓                │     │ main.ts  │ ← 蓝色 = 现有代码     │
│  Mapper             │     └────┬─────┘                       │
│    ↓                │          │ calls                       │
│  Executor           │     ┌────▼─────┐                       │
│    ↓                │     │ auth.ts  │ ← 红色 = 问题节点     │
│  Reviewer           │     └──────────┘                       │
│                     │                                        │
│  [input] [Send]     │    拖拽 / 缩放 / 点击节点              │
│                     │                                        │
└─────────────────────┴────────────────────────────────────────┘
```

## Agent Pipeline

Four specialized agents work independently, each with its own LLM call and context:

| Agent | Role | Tools |
|-------|------|-------|
| **Planner** | Reads code, analyzes structure, creates execution plan | read_file, list_dir |
| **Mapper** | Takes the plan, reads code, draws the call graph | read_file, list_dir |
| **Executor** | Executes plan steps — edits code, runs commands | read_file, write_file, run_shell |
| **Reviewer** | Reviews execution against plan and user intent | read_file |

**Flow**: `User Input → Planner → Mapper → Executor → Reviewer`
- Reviewer passes → Done ✓
- Reviewer rejects → Back to Planner with feedback ↻

Each agent has its own system prompt and does not share conversation context. Data is passed between agents as structured output (plan JSON → call graph JSON → execution results → review).

## Call Graph

The **Mapper agent** produces a Node-Link Graph rendered on the canvas:

- 🔵 **Blue** — existing code nodes
- 🔴 **Red** — problem locations
- 🟡 **Yellow** — planned changes
- 🟢 **Green** — new additions

Edges show call relationships (calls, imports, returns). The graph updates in real-time as the Executor and Reviewer progress.

## Features

- **4-Agent Pipeline** — Planner plans, Mapper draws, Executor runs, Reviewer checks
- **Call Graph Visualization** — Interactive SVG node-link diagram, pan/zoom, click for details
- **SSE Streaming** — All agent responses stream token-by-token with reasoning support
- **File Operations** — Read, edit, insert, replace, delete files via natural language
- **Shell Execution** — Agent runs build/test commands, feeds output back for analysis
- **Settings Panel** — Configure LLM endpoint, API key, and model from the UI
- **Dark Theme** — IBM Carbon-inspired design system
- **Custom Title Bar** — Frameless window with window controls

## Tech Stack

- **Frontend**: Electron, React 19, TypeScript, Tailwind CSS, Vite 6
- **Backend**: Express (embedded in Electron main process), better-sqlite3, OpenAI SDK
- **Build**: vite-plugin-electron

No external Python process — everything runs in a single Electron application.

## Quick Start

### Prerequisites

- Node.js 20+

### Setup

```bash
git clone https://github.com/wangzhongren/CodeAtlas.git
cd CodeAtlas/frontend
npm install
```

### Configure LLM

Click the ⚙️ gear icon in the toolbar to set your API key, base URL, and model — or create a `.env` file:

```bash
cp .env.example .env
```

```
CODEATLAS_LLM_API_KEY=sk-...
CODEATLAS_LLM_BASE_URL=https://api.openai.com/v1
CODEATLAS_LLM_MODEL=gpt-4o
```

### Run

```bash
cd frontend
npm run electron:dev
```

Or on Windows, double-click `start.bat`.

## Project Data

Analysis data is stored in `.codeatlas/` inside your project directory:

| Path | Purpose |
|------|---------|
| `.codeatlas/codeatlas.db` | SQLite database (feature graph, change queue, meta) |

## License

Apache License, Version 2.0. See [LICENSE](LICENSE).

Copyright 2026 wangzhongren
