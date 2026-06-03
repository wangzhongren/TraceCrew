# CodeAtlas

AI-powered code exploration and editing IDE — visualize architecture, edit code, run commands, all through natural language.

## Features

- **AI Chat Agent** — Read files, search code, browse directories through conversation. Evidence-based: only makes claims backed by actual file content. Supports read-only and execute modes with intent classification.
- **Planner + Worker** — Complex tasks trigger a two-phase workflow: the Planner explores the project and generates a structured step-by-step plan, the user confirms, then Worker agents execute each step autonomously.
- **AI Terminal** — Dedicated terminal window with split-pane layout: terminal output on the left, AI chat on the right. Supports ANSI colors, plan-based execution, and interactive conversation.
- **Project Overview Agent** — Autonomous agent explores your codebase, generates architectural overviews, and detects issues (missing imports, API mismatches, etc.)
- **Feature Tree** — Hierarchical navigation: Overview → Feature Groups → Features. Click to drill down, lazy-load deeper details on demand. Click files to jump to code.
- **Code Search** — Agent can search across files using keyword matching. Results include file path, line number, and context.
- **Code Viewer** — Syntax highlighting, line numbers, clickable function navigation, scroll-to-line.
- **Markdown Rendering** — Agent responses render with full Markdown support: headers, code blocks, lists, blockquotes, inline code, links.
- **File Operations** — Create, edit, insert, replace, delete files. Delete moves to trash with backup. All changes are reversible.
- **Send to Agent** — One click to send feature context (files, functions, descriptions) from the analysis panel to the chat agent.
- **Background Tasks** — Status bar tracks all running analyses, shell commands, and summaries.
- **Resizable Panels** — Drag to resize file explorer, code viewer, agent chat, and feature panels.
- **Streaming Responses** — LLM replies stream token-by-token with reasoning content support. Stop button to cancel mid-generation.
- **Custom Title Bar** — Frameless window with VSCode-style window controls.

## Architecture

```
┌──────────┬───────────────────┬──────────────┐
│ Explorer │    Code Viewer    │  Agent Chat  │
│   File   │   (highlighting)  │  (streaming) │
│   Tree   │                   │              │
├──────────┴───────────────────┤              │
│    Feature Tree + Detail     │              │
└──────────────────────────────┴──────────────┘

AI Terminal (separate window):
┌────────────────────┬──────────────┐
│    Terminal Log    │  AI Chat     │
│  (ANSI colors)     │  (Markdown)  │
│                    │  + Plan UI   │
└────────────────────┴──────────────┘
```

## Agent Modes

The agent operates in two modes, determined by automatic intent classification:

- **Read-only mode** (default) — Agent can read files, list directories, and search code. It answers questions and suggests changes but does not modify anything.
- **Execute mode** — When the user's intent is to make changes (e.g. "fix the bug", "add a feature"), the agent enters execute mode:
  - For simple changes: directly outputs edit operations
  - For complex tasks: triggers the **Planner** to explore the project and generate a step-by-step plan. User reviews and confirms, then **Worker** agents execute each step.

## Tech Stack

- **Frontend**: Electron 35, React 19, TypeScript, Zustand, Tailwind CSS, Vite 6
- **Backend**: FastAPI, SQLite (WAL mode), OpenAI-compatible SDK
- **Build**: vite-plugin-electron, electron-builder

## Quick Start

### Prerequisites

- Node.js 24+
- Python 3.12+

### Setup

```bash
# Clone
git clone https://github.com/wangzhongren/CodeAtlas.git
cd CodeAtlas

# Install frontend deps (includes Electron)
cd frontend && npm install

# Install backend deps
cd ../backend && pip install -r requirements.txt

# Configure API key
cp .env.example .env
# Edit .env with your LLM API credentials
```

### Run

```bash
.\start.bat
```

Or manually:

```bash
# Terminal 1 — Backend
cd backend
python -m uvicorn main:app --port 19850 --reload

# Terminal 2 — Electron
cd frontend
npm run electron:dev
```

## Configuration

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

| Variable | Description |
|----------|-------------|
| `CODEATLAS_LLM_API_KEY` | Your LLM API key |
| `CODEATLAS_LLM_BASE_URL` | LLM API base URL (OpenAI-compatible) |
| `CODEATLAS_LLM_MODEL` | Model name (e.g. `gpt-4o`, `deepseek-v4-pro`) |

> `.env` is gitignored — never commit your real credentials.

## How It Works

1. **Open a project folder** — The file tree appears on the left
2. **Ask the Agent** (right panel) — Ask questions, read code, search files. The Agent reads files as evidence before making claims.
3. **Execute tasks** — When you ask the Agent to make changes (e.g. "fix the login bug"), it classifies your intent and enters execute mode:
   - Simple changes: directly edits files
   - Complex tasks: generates a plan with steps for you to review, then executes after confirmation
4. **AI Terminal** — Click the terminal button in the title bar to open a dedicated window with terminal + chat split view. Ideal for build/run/debug workflows.
5. **Analyze features** (bottom-left) — Click the refresh icon to generate a feature tree: Overview → Groups → Features
6. **Drill down** — Click nodes to expand in the left tree. Select nodes to see details. Click "Expand details" to lazy-load deeper analysis.
7. **Send to Agent** — Click "Ask Agent" on any feature to send context to the chat for targeted edits.

## Project Data

All analysis data is stored in `.codeatlas/` inside your opened project directory:

| File | Purpose |
|------|---------|
| `.codeatlas/codeatlas.db` | SQLite database (feature graph, change queue) |

## Development

```bash
# Backend with hot-reload
cd backend && python -m uvicorn main:app --port 19850 --reload

# Frontend only (no Electron)
cd frontend && npm run dev

# Full Electron app (dev mode)
cd frontend && npm run electron:dev

# Production build
cd frontend && npm run build
```

## License

CodeAtlas is licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for the full text.

Copyright 2026 wangzhongren
