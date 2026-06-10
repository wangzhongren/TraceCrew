# CodeAtlas

AI-powered code exploration and analysis IDE. Natural language driven, with a multi-agent pipeline that plans, maps, and reviews code — visualized as an interactive call graph with annotated change locations.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Title Bar                                 │
├──────────────────────┬───────────────────────────────────────────┤
│                      │                                           │
│    Chat Panel        │        Mapper View                        │
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
│  ReviewCard          │  点击节点 → 右侧详情面板                   │
│                      │  拖拽 / 缩放 / 树形展开                    │
│  [input] [Send]      │                                           │
│                      │                                           │
└──────────────────────┴───────────────────────────────────────────┘
```

## Agent Pipeline

Multiple specialized agents, each with its own LLM context. Tool execution is handled entirely by the backend — frontend sends one request per agent and streams results.

| Agent | Role | Status Annotations |
|-------|------|--------------------|
| **Planner** | Explores codebase, creates structured execution plan | Identifies problems, key files, and dependencies |
| **Mapper** | Traces call chains, draws annotated call graph | `existing` / `problem` / `planned_change` / `planned_new` |
| **Reviewer** | Validates Planner's analysis against code evidence | Pass → Mapper / Fail → Retry Planner |

**Flow**: `User Input → Planner → Reviewer → Mapper`
- Planner reads code, outputs structured plan (JSON)
- Reviewer validates the plan against real code — passes or sends back to Planner with feedback ↻
- Mapper traces relevant call chains, draws annotated graph with change locations (only after plan is approved)
- Executor (`runExecutor`) is reserved for manual execution trigger (coming soon)

Each agent uses the backend tool loop — the LLM outputs file operations, the backend executes them server-side, and feeds results back. Multiple tool-calling rounds are transparent to the frontend.

## Call Graph

The **Mapper agent** produces an annotated call graph displayed in the right panel:

- ◈ **Blue** — existing code nodes (normal flow)
- ✕ **Red** — problem + fix locations (detail shows current state → planned fix)
- \+ **Green** — new additions (new files/functions)

**Node cards** show: status icon, Chinese status label, label with source prefix ([前端]/[后端]/[IPC]/[库]), file path, line number, and detail description.

**Edges** show: call relationships with labels, colored by status — existing (blue-gray), new (green), error (red). Back-edges rendered as curved arcs.

**Code Viewer**: Click a node to open its source file in a right-hand panel, auto-scrolled to the function definition line. Panel width is draggable.

**Two views**: Dagre-layered node-link diagram (longest-path ranking + crossing minimization), and collapsible tree view for call chain navigation.

## Features

- **Multi-Agent Pipeline** — Planner → Reviewer → Mapper, with `<final/>` explicit completion
- **Action Toolbar** — 5 operations: Test, Fix, Refactor, Explain, Develop — each with streaming backend + Reviewer validation
- **Server-Side Tool Execution** — LLM tools (read, write, search, shell) executed by backend, one request per agent
- **Call Graph Visualization** — Dagre-layered SVG node-link diagram with unified dimension (function/module/component)
- **File Semantic Indexing** — Async summarization after each `read_file`, cached to SQLite, injected into future context
- **SSE Streaming** — All agent responses stream token-by-token with reasoning support, collapsible AgentBlock UI
- **11 File Operations** — list_dir, read_file, search (regex/whole-word/case-sensitive), insert_lines, replace_lines, delete_lines, create_file, delete_file, run_shell, restoreBackup
- **Streaming File Edits** — Automatic line-by-line streaming for large files (>500KB), memory-safe
- **Code Viewer Panel** — Right-side panel shows source code on node click, auto-scrolls to line, draggable width
- **Resizable Panels** — ChatPanel, MapperView, and CodeViewer widths all adjustable via drag handles
- **Dark Theme** — GitHub-inspired design system with 3-layer CSS tokens (variables → global classes → Tailwind)
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
git clone https://github.com/wangzhongren/CodeAtlas.git
cd CodeAtlas/frontend
npm install
```

### Configure LLM

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

```
CODEATLAS_LLM_API_KEY=sk-...
CODEATLAS_LLM_BASE_URL=https://api.openai.com/v1
CODEATLAS_LLM_MODEL=gpt-4o
```

Or use the ⚙️ gear icon in the toolbar to configure from the UI.

### Run

```bash
cd frontend
npm run electron:dev
```

On Windows, double-click `start.bat`.

## Project Data

| Path | Purpose |
|------|---------|
| `.codeatlas/codeatlas.db` | SQLite database (features, file summaries, change queue) |
| `.codeatlas/backups/` | File backups before edits (with meta.json) |
| `.codeatlas-logs/` | Shell execution logs |

## License

Apache License, Version 2.0. See [LICENSE](LICENSE).

Copyright 2026 wangzhongren
