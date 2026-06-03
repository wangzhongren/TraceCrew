"""
Unified Feature Map Analyzer — single autonomous agent that takes only a project_path,
explores files autonomously, and produces the complete 4-level feature graph in one shot.
"""

import asyncio
import json
import logging
import os
import re
from datetime import datetime
from pathlib import Path
from typing import List

from openai import AsyncOpenAI

from models.feature import FeatureNode
from services.db import save_features
from services.feature_analyzer import feature_analyzer as _fa, INCREMENTAL_PROMPT

logger = logging.getLogger("codeatlas.unified_analyzer")

# ── Directory / file ignore rules (mirrors Electron fileManager.ts) ──
IGNORE_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv", ".venv312",
    "dist", "dist-electron", "release", ".next", ".nuxt", "coverage",
    ".cache", ".codeatlas", ".codeatlas-logs",
}
IGNORE_EXTENSIONS = {".pyc", ".pyo", ".exe", ".dll", ".so", ".dylib", ".DS_Store"}
SOURCE_EXTENSIONS = {".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".java",
                     ".json", ".toml", ".yaml", ".yml", ".md", ".cfg", ".ini",
                     ".css", ".html", ".vue", ".svelte"}
KEY_FILE_NAMES = {
    "package.json", "README.md", "pyproject.toml", "go.mod", "Cargo.toml",
    "Makefile", "Dockerfile", "main.py", "app.py", "main.ts", "main.tsx",
    "index.ts", "index.tsx", "setup.py",
}

# ── Unified prompt: generates the complete 4-level tree in one shot ──
UNIFIED_PROMPT = """你是一个代码架构分析专家。你已经阅读了项目的关键文件内容，现在需要生成一份完整的、从入口开始展开的思维导图。

【证据规则——严禁编造】
1. 你只能基于实际读到的文件内容生成节点，不确定的东西不要写
2. files 必须是代码中真实存在的文件路径（从文件树中选），函数名必须是代码中实际定义的
3. 行号必须从代码行号标注中获取（每行前面有 "行号|"），不确定就不写
4. 宁可少生成也不要编造，追求质量而非数量

【地图层级结构】
- Level 0: project_overview — 项目总览
- Level 1: groups — 运行时边界/系统边界（如 Electron 主进程、React 渲染界面、FastAPI 后端）
- Level 2: features — 每个边界内的入口点或关键模块
- Level 3: steps — 每个功能内部的流程步骤（2-8 个）
- Level 4: details — 每个步骤的具体代码实现细节（可选，2-5 个）

【输出格式】纯 JSON：
{
  "project_overview": {
    "label": "Entry Map",
    "description": "一句话描述（基于代码证据）",
    "flow_description": "从入口展开的架构概述（基于代码，Markdown 格式）"
  },
  "groups": [
    {
      "id": "grp_xxx",
      "label": "边界名称",
      "description": "这个运行时的核心职责",
      "features": [
        {
          "id": "feat_xxx",
          "label": "入口点/关键模块",
          "description": "具体做什么",
          "flow_description": "调用/控制流概述（Markdown）",
          "files": ["实际文件路径"],
          "functions": ["函数名:行号"],
          "steps": [
            {
              "id": "step_xxx",
              "label": "步骤名称",
              "description": "这个步骤做什么",
              "flow_description": "具体实现细节（Markdown）",
              "files": ["该步骤涉及的文件"],
              "functions": ["函数名:行号"],
              "details": [
                {
                  "id": "detail_xxx",
                  "label": "代码细节",
                  "description": "关键实现细节描述",
                  "files": ["文件路径"],
                  "functions": ["函数名:行号"]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}

【规则】
- groups 1-5 个，对应真实运行时边界
- features 1-5 个每组，选择入口文件/路由注册/组件根/IPC 注册等
- steps 2-8 个每 feature，太少或太简单的功能可以减少 steps
- details 可选，对复杂步骤才加，2-5 个
- id 用英文短标识（如 grp_backend, feat_main_api, step_chat_handler）
- flow_description 用 Markdown 格式，简洁准确
- 所有 label/description/flow_description 必须使用指定的输出语言

【Markdown 格式规则 — 严格遵循】
- 段落之间必须用空行（两个换行 \\n\\n）分隔
- 列表项（- xxx）之间可以单换行，但列表前后要有空行
- 使用 ## 和 ### 做标题层级
- 代码引用用反引号 `functionName`
- 多行代码块用三反引号包裹
- 在 JSON 字符串中，换行写 \\n，如 "第一段\\n\\n第二段\\n\\n- 列表项1\\n- 列表项2"
- 文件路径中的反斜杠必须转义，Windows 路径如 C:\\\\Users\\\\file 要写成 C:\\\\\\\\Users\\\\\\\\file
- 不要包含任何未转义的反斜杠，不要把所有内容写成一个连续段落"""

BOUNDARY_DISCOVERY_PROMPT = """你是项目架构分析师。你需要探索项目目录结构，识别运行时边界和入口文件。

你有两个工具可用：
- list_dir(path) — 列出目录内容，返回以项目根目录为基准的相对路径
- read_file(path) — 读取文件内容（带行号标注），path 使用 list_dir 返回的相对路径

【路径规则 —— 非常重要】
- list_dir 返回的所有路径都是相对于项目根目录的（如 backend/main.py, frontend/src/App.tsx）
- read_file 和输出 JSON 中的 files 字段必须直接使用这些相对路径，不要编造
- 先 list_dir('.') 从根目录开始探索

请先 list_dir 根目录，再根据发现逐步深入。当你对项目结构有足够了解后，输出最终结果。

【最终输出格式】纯 JSON：
{
  "project_overview": {
    "label": "Entry Map",
    "description": "一句话（基于实际看到的文件）",
    "flow_description": "架构概述"
  },
  "boundaries": [
    {
      "id": "grp_xxx",
      "label": "边界名称",
      "description": "这个边界做什么",
      "entry_files": ["入口文件路径"],
      "support_files": ["支撑文件路径"]
    }
  ]
}

【规则】
- 先 list_dir，看到重要文件就 read_file
- entry_files: 1-3 个核心文件
- 总数 2-5 个边界
- 最多 10 次工具调用"""

BOUNDARY_ANALYSIS_PROMPT = """你是代码分析师。分析指定的运行时边界，产出这个边界内的关键功能模块（二级节点）。

工具: read_file(path) — path 使用相对路径（如 backend/main.py）

【路径规则】
- 所有路径都是相对于项目根目录的相对路径
- 输出 JSON 中的 files 字段直接使用相对路径

【工作方式】
先读入口文件，看到 import/require 引用了同边界内的其他重要文件时，继续 read_file。
只需要识别功能模块即可，不需要深入分析每个模块的内部流程。
够了就输出最终结果。

【最终输出格式】纯 JSON：
{
  "features": [
    {
      "id": "feat_xxx",
      "label": "功能名称",
      "description": "这个功能做什么",
      "flow_description": "功能概述（Markdown，简要说明核心流程即可）",
      "files": ["文件路径"],
      "functions": ["函数名:行号"]
    }
  ]
}

【规则——证据优先】
- 不编造，基于代码
- features 1-5 个
- 不需要输出 steps，只输出 features
- 最多 5 次工具调用"""

# ── Tool definitions for function calling ──

DISCOVERY_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_dir",
            "description": "列出目录内容。返回的所有路径都是相对于项目根目录的相对路径（如 backend/main.py），可直接用于 read_file 和输出 files[]",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对于项目根目录的路径，空字符串或 '.' 表示根目录"}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "读取文件内容（带行号），使用 list_dir 返回的相对路径。大文件请带 intent 让子代理按需提取",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对于项目根目录的文件路径（从 list_dir 返回的路径直接使用）"},
                    "intent": {"type": "string", "description": "想了解什么？如 '入口点''路由注册''IPC处理'，大文件必填"}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "finish",
            "description": "探索完成，返回识别出的边界列表",
            "parameters": {
                "type": "object",
                "properties": {
                    "result": {
                        "type": "object",
                        "description": "边界发现结果",
                        "properties": {
                            "project_overview": {"type": "object"},
                            "boundaries": {"type": "array"}
                        }
                    }
                },
                "required": ["result"]
            }
        }
    }
]

ANALYSIS_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "读取文件内容（带行号），使用相对路径如 backend/main.py。大文件请带 intent 让子代理按需提取",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "相对于项目根目录的文件路径（如 backend/main.py），输出 files[] 也使用相同格式"},
                    "intent": {"type": "string", "description": "想了解什么？如 '入口点''API路由'，大文件必填"}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "finish",
            "description": "分析完成，返回功能和流程步骤",
            "parameters": {
                "type": "object",
                "properties": {
                    "result": {
                        "type": "object",
                        "description": "边界分析结果",
                        "properties": {
                            "features": {"type": "array"}
                        }
                    }
                },
                "required": ["result"]
            }
        }
    }
]


class UnifiedAnalyzer:
    """Single autonomous agent: given a project_path, produce the complete feature graph."""

    def __init__(self):
        self.client = AsyncOpenAI(
            api_key=os.getenv("CODEATLAS_LLM_API_KEY"),
            base_url=os.getenv("CODEATLAS_LLM_BASE_URL"),
        )
        self.model = os.getenv("CODEATLAS_LLM_MODEL")

    # ── Helpers (reuse patterns from feature_analyzer.py) ──

    def _clean(self, raw: str) -> str:
        raw = raw.strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        return raw.strip()

    def _make_relative(self, filepath: str, project_path: str) -> str:
        try:
            pp = os.path.normpath(project_path)
            fp = os.path.normpath(filepath)
            if fp.lower().startswith(pp.lower()):
                return os.path.relpath(fp, pp).replace("\\", "/")
        except Exception:
            pass
        return filepath.replace("\\", "/")

    def _resolve_existing(self, filepath: str, project_path: str) -> str | None:
        """Resolve relative path and return it only if the file actually exists on disk."""
        rel = self._make_relative(filepath, project_path)
        full = os.path.join(project_path, rel)
        if os.path.isfile(full):
            return rel
        # Try absolute path directly
        if os.path.isfile(filepath):
            return filepath
        return None

    def _read_file(self, filepath: str) -> str:
        """Read file with line numbers prepended. Large files get truncated to keep context manageable."""
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                lines = f.readlines()
            max_lines = 4000  # keep context under control
            total = len(lines)
            if total > max_lines:
                # Keep first 1/3 and last 1/6 for structure + tail context
                head = lines[:max_lines * 2 // 3]
                tail = lines[-(max_lines // 3):]
                lines = head + [f"    ...({total - max_lines} lines truncated)...\n"] + tail
            numbered = []
            for i, line in enumerate(lines, 1):
                numbered.append(f"{i:4d}| {line.rstrip()}")
            content = "\n".join(numbered)
            return content
        except Exception:
            return f"[无法读取: {filepath}]"

    # ── File tree building (backend-side, no Electron IPC needed) ──

    def _build_file_tree(self, project_path: str, max_depth: int = 4) -> list[dict]:
        """Build structured file tree identical to Electron's listDirectory return format."""
        root = Path(project_path)

        def walk(current: Path, depth: int) -> list[dict]:
            if depth > max_depth:
                return []
            entries = []
            try:
                items = sorted(current.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
            except PermissionError:
                return []

            for item in items:
                name = item.name
                if name.startswith(".") and name not in (".env.example",):
                    continue
                if item.is_dir():
                    if name in IGNORE_DIRS:
                        continue
                    children = walk(item, depth + 1)
                    entries.append({
                        "name": name,
                        "path": str(item).replace("\\", "/"),
                        "type": "directory",
                        "children": children,
                    })
                elif item.is_file():
                    if item.suffix in IGNORE_EXTENSIONS:
                        continue
                    # Skip binary/non-source files
                    ext_lower = item.suffix.lower()
                    if ext_lower and ext_lower not in SOURCE_EXTENSIONS:
                        # Still show config files at top level
                        if depth > 1 or ext_lower not in {".json", ".toml", ".yaml", ".yml", ".md"}:
                            continue
                    size = item.stat().st_size
                    entries.append({
                        "name": name,
                        "path": str(item).replace("\\", "/"),
                        "type": "file",
                        "size": size,
                    })
            return entries

        return walk(root, 1)

    def _format_tree_text(self, tree: list[dict], indent: str = "") -> str:
        """Render file tree as human-readable text (like `tree` command)."""
        lines = []
        for i, entry in enumerate(tree):
            is_last = (i == len(tree) - 1)
            prefix = "└── " if is_last else "├── "
            child_indent = indent + ("    " if is_last else "│   ")
            name = entry["name"]
            if entry["type"] == "directory":
                lines.append(f"{indent}{prefix}{name}/")
                if entry.get("children"):
                    lines.append(self._format_tree_text(entry["children"], child_indent))
            else:
                size = entry.get("size", 0)
                size_str = f" ({size}B)" if size < 1024 else f" ({size//1024}KB)"
                lines.append(f"{indent}{prefix}{name}{size_str}")
        return "\n".join(lines)

    def _find_key_files(self, file_tree: list, project_path: str, max_files: int = 12) -> list[str]:
        """Auto-discover important files to pre-read."""
        key_files: list[str] = []

        def walk(entries: list, depth: int = 0):
            if depth > 3:
                return
            for e in entries:
                if e.get("type") == "file":
                    name = e.get("name", "")
                    path_str = e.get("path", "")
                    if name in KEY_FILE_NAMES or any(
                        pat in name or pat in path_str
                        for pat in ["main.py", "app.py", "main.ts", "main.tsx",
                                     "index.ts", "index.tsx", "App.tsx"]
                    ):
                        rel = self._make_relative(path_str, project_path)
                        if rel not in key_files:
                            key_files.append(rel)
                if e.get("type") == "directory" and e.get("children"):
                    walk(e["children"], depth + 1)

        walk(file_tree)
        # Also discover key source files in top-level dirs
        def collect_source_files(entries: list, depth: int = 0):
            if depth > 2 or len(key_files) >= max_files:
                return
            for e in entries:
                if e.get("type") == "file":
                    name = e.get("name", "")
                    path_str = e.get("path", "")
                    _, ext = os.path.splitext(name)
                    if ext in SOURCE_EXTENSIONS and name not in {"LICENSE", ".gitignore"}:
                        rel = self._make_relative(path_str, project_path)
                        if rel not in key_files:
                            key_files.append(rel)
                if e.get("type") == "directory" and e.get("children"):
                    collect_source_files(e["children"], depth + 1)

        collect_source_files(file_tree)
        return key_files[:max_files]

    # ── JSON extraction & repair (reuse patterns) ──

    def _extract_json_object(self, raw: str) -> str:
        cleaned = self._clean(raw)
        if not cleaned:
            return "{}"
        if cleaned.startswith("{") and cleaned.endswith("}"):
            return cleaned

        start = cleaned.find("{")
        if start < 0:
            raise ValueError("LLM response did not contain a JSON object")

        depth = 0
        in_string = False
        escaped = False
        for idx in range(start, len(cleaned)):
            ch = cleaned[idx]
            if in_string:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == '"':
                    in_string = False
                continue
            if ch == '"':
                in_string = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return cleaned[start:idx + 1]
        raise ValueError("LLM response contained an incomplete JSON object")

    def _sanitize_json_escapes(self, s: str) -> str:
        """Fix invalid JSON escape sequences (e.g., Windows paths, stray backslashes)."""
        # Valid JSON escapes: \" \\ \/ \b \f \n \r \t \uXXXX
        result = []
        i = 0
        while i < len(s):
            if s[i] == '\\':
                if i + 1 < len(s):
                    nxt = s[i + 1]
                    if nxt in '"\\/bfnrtu':
                        result.append(s[i:i+2])
                        if nxt == 'u':
                            # \uXXXX — copy full 6-char sequence
                            result.append(s[i+2:i+6])
                            i += 4
                        i += 2
                        continue
                    # Invalid escape — double the backslash
                    result.append('\\\\')
                    result.append(nxt)
                    i += 2
                    continue
            result.append(s[i])
            i += 1
        return ''.join(result)

    def _loads_json_object(self, raw: str) -> dict:
        extracted = self._extract_json_object(raw)
        try:
            return json.loads(extracted)
        except json.JSONDecodeError:
            # Try sanitizing invalid escapes; if that also fails, re-raise for LLM repair
            return json.loads(self._sanitize_json_escapes(extracted))

    async def _repair_json_object(self, raw: str, purpose: str) -> dict:
        response = await self.client.chat.completions.create(
            model=self.model,
            temperature=0,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a JSON repair tool. The user will provide a malformed JSON string. "
                        "Fix ALL syntax errors: missing commas between fields, unclosed strings, "
                        "trailing commas, invalid escapes, unbalanced braces. "
                        "Return ONLY the fixed, valid JSON object — "
                        "no markdown fences, no explanations, no extra text whatsoever."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Purpose: {purpose}\n\nMalformed response (fix all syntax errors):\n{raw[:12000]}",
                },
            ],
        )
        repaired = response.choices[0].message.content or "{}"
        return self._loads_json_object(repaired)

    async def _loads_json_with_repair(self, raw: str, purpose: str) -> dict:
        try:
            return self._loads_json_object(raw)
        except Exception as exc:
            logger.warning("[UnifiedAnalyzer] JSON parse failed for %s: %s", purpose, exc)
            try:
                return await self._repair_json_object(raw, purpose)
            except Exception:
                raise exc

    # ── Recursive node tree builder ──

    def _build_node_tree(self, data: dict, project_path: str) -> FeatureNode:
        """Recursively construct FeatureNode tree from parsed LLM output."""
        overview = data.get("project_overview", {})

        groups: list[FeatureNode] = []
        for g in data.get("groups", []):
            features: list[FeatureNode] = []
            for f in g.get("features", []):
                f_files = [self._make_relative(fp, project_path) for fp in f.get("files", [])]

                steps: list[FeatureNode] = []
                for s in f.get("steps", []):
                    s_files = [self._make_relative(fp, project_path) for fp in s.get("files", [])]

                    details: list[FeatureNode] = []
                    for d in s.get("details", []):
                        d_files = [self._make_relative(fp, project_path) for fp in d.get("files", [])]
                        detail_id = f"{s['id']}.{d['id']}"
                        details.append(FeatureNode(
                            id=detail_id, label=d["label"], level=4,
                            parent_id=s["id"],
                            description=d.get("description", ""),
                            flow_description=d.get("flow_description", ""),
                            files=d_files,
                            functions=d.get("functions", []),
                        ))

                    steps.append(FeatureNode(
                        id=s["id"], label=s["label"], level=3,
                        parent_id=f["id"],
                        description=s.get("description", ""),
                        flow_description=s.get("flow_description", ""),
                        files=s_files,
                        functions=s.get("functions", []),
                        children=details,
                    ))

                features.append(FeatureNode(
                    id=f["id"], label=f["label"], level=2,
                    parent_id=g["id"],
                    description=f.get("description", ""),
                    flow_description=f.get("flow_description", ""),
                    files=f_files,
                    functions=f.get("functions", []),
                    children=steps,
                ))

            groups.append(FeatureNode(
                id=g["id"], label=g["label"], level=1,
                parent_id="project_overview",
                description=g.get("description", ""),
                flow_description="",
                files=[], functions=[],
                children=features, generated=True,
            ))

        root = FeatureNode(
            id="project_overview",
            label=overview.get("label", "Entry Map"),
            level=0,
            description=overview.get("description", ""),
            flow_description=overview.get("flow_description", ""),
            files=[], functions=[],
            children=groups,
            generated=True,
        )
        return root

    # ── Validation ──

    def _validate_tree(self, root: FeatureNode) -> list[str]:
        """Basic structural validation of the feature tree. Returns list of warnings."""
        warnings: list[str] = []

        def check(node: FeatureNode, depth: int):
            if not node.id:
                warnings.append(f"Node at depth {depth} has empty id")
            if not node.label:
                warnings.append(f"Node {node.id} has empty label")
            if node.parent_id is None and node.level != 0:
                warnings.append(f"Non-root node {node.id} has no parent_id")
            for c in (node.children or []):
                check(c, depth + 1)

        check(root, 0)

        # Count nodes
        def count(n: FeatureNode) -> int:
            return 1 + sum(count(c) for c in (n.children or []))
        total = count(root)
        if total < 3:
            warnings.append(f"Tree has only {total} nodes — likely incomplete")

        logger.info(f"[UnifiedAnalyzer] Validation: {total} nodes, {len(warnings)} warnings")
        return warnings

    def _build_context(self, read_files: dict, max_chars: int = 60000) -> str:
        """Assemble file contents into a context string, keeping files whole.
        If total exceeds max_chars, drop the largest files first, but keep at
        least 3 files to ensure the agent has enough evidence."""
        if not read_files:
            return "(no files read)"

        # Sort: prefer smaller files first (more files in the window)
        items = sorted(read_files.items(), key=lambda kv: len(kv[1]))
        if len(items) > 3:
            # Always keep the first entry file if present
            key_names = {'main.ts', 'main.tsx', 'main.py', 'app.py', 'App.tsx',
                         'index.ts', 'index.tsx', 'package.json'}
            key_items = [(k, v) for k, v in items if os.path.basename(k) in key_names]
            other_items = [(k, v) for k, v in items if os.path.basename(k) not in key_names]
            # Key files first, then others by size
            items = key_items + other_items

        parts = []
        total = 0
        for k, v in items:
            header = f"=== {k} ===\n"
            content = v
            block = header + content + "\n\n"
            if total + len(block) > max_chars and len(parts) >= 3:
                remaining = max_chars - total - len(header)
                if remaining > 500:
                    parts.append(f"{header}{content[:remaining]}\n... (file truncated)\n\n")
                break
            parts.append(block)
            total += len(block)

        return "".join(parts)

    # ── Tool execution helpers ──

    def _tool_list_dir(self, project_path: str, rel_path: str) -> str:
        """List directory contents, returning relative paths from project root.
        AI can use these paths directly in read_file() and in its output JSON files[]."""
        target = project_path if rel_path in ("", ".", "/") else os.path.join(project_path, rel_path)
        if not os.path.isdir(target):
            return f"Error: not a directory: {rel_path}"
        try:
            items = []
            for name in sorted(os.listdir(target)):
                if name.startswith(".") and name not in (".env.example",):
                    continue
                full = os.path.join(target, name)
                # Build path relative to project root so AI always has correct paths
                try:
                    rel = os.path.relpath(full, project_path).replace("\\", "/")
                except ValueError:
                    rel = name
                if os.path.isdir(full):
                    if name in IGNORE_DIRS: continue
                    items.append(f"  📁 {rel}/")
                else:
                    ext = os.path.splitext(name)[1].lower()
                    if ext in IGNORE_EXTENSIONS: continue
                    size = os.path.getsize(full)
                    size_s = f"{size}B" if size < 1024 else f"{size//1024}KB"
                    items.append(f"  📄 {rel} ({size_s})")
            return "\n".join(items) if items else "(empty)"
        except PermissionError:
            return "Error: permission denied"

    async def _tool_read_file(self, project_path: str, rel_path: str, intent: str = "") -> str:
        """Read a file via sub-agent: always extract only what matches the intent.
        This keeps the main conversation context small."""
        full = os.path.join(project_path, rel_path)
        if not os.path.isfile(full):
            return f"Error: file not found: {rel_path}"
        ext = os.path.splitext(rel_path)[1].lower()
        if ext and ext not in SOURCE_EXTENSIONS:
            return f"Error: not a source file: {rel_path}"

        content = self._read_file(full)

        # No intent: return a brief overview so AI can decide what intent to ask for
        if not intent:
            # Show first few functions/classes as a preview
            preview_lines = content.split("\n")[:80]
            return (
                "\n".join(preview_lines)
                + f"\n\n... (文件 {len(content)//1024}KB，共 {content.count(chr(10))+1} 行)"
                + "\n请使用 intent 参数指定你想了解的内容，如 '入口点'、'路由注册'、'IPC处理'。"
            )

        # Sub-agent: extract only code relevant to the intent
        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": (
                    "你是代码提取助手。用户需要从文件中找到与特定意图相关的代码。\n"
                    "规则:\n"
                    "1. 只返回与意图直接相关的函数、类、代码块\n"
                    "2. 不相关的代码一律省略，不要返回整个文件\n"
                    "3. 保留原始行号标注\n"
                    "4. 用 `### 函数名:行号` 或 `### 类名:行号` 标注每个代码块\n"
                    "5. 如果找不到相关内容，回答 '未找到与意图相关的代码'\n"
                    "6. 返回内容尽量简洁，控制在 2000 字以内"
                )},
                {"role": "user", "content": (
                    f"文件: {rel_path}\n意图: {intent}\n\n内容:\n{content}"
                )},
            ],
            temperature=0,
        )
        extracted = response.choices[0].message.content or "未找到相关内容"
        return f"[子代理按意图提取: {intent}]\n{extracted}"

    async def _tool_loop(self, project_path: str, system_prompt: str, user_msg: str,
                          tools: list, max_rounds: int = 10, language: str = "en",
                          on_progress=None) -> dict:
        """Function calling loop: LLM calls tools, we execute them, until it calls finish."""
        is_zh = language == "zh"

        def progress(label: str):
            logger.info(f"[UnifiedAnalyzer] Progress: {label}")
            if on_progress:
                on_progress({"event": "progress", "data": json.dumps(
                    {"step": "tool", "label": label}, ensure_ascii=False)})

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_msg},
        ]

        for round_num in range(max_rounds):
            progress(f"AI 思考中... (第{round_num+1}轮)" if is_zh else f"AI thinking... (round {round_num+1})")

            # Trim context if messages grow too large from file reads
            def _msg_content(m) -> str:
                if isinstance(m, dict): return m.get("content", "") or ""
                return getattr(m, "content", "") or ""

            MAX_CONTEXT_CHARS = 120_000
            total_chars = sum(len(_msg_content(m)) for m in messages)
            if total_chars > MAX_CONTEXT_CHARS:
                keep = [messages[0], messages[1]]
                tail = []
                tail_chars = 0
                i = len(messages) - 1
                while i >= 2 and tail_chars < MAX_CONTEXT_CHARS // 2:
                    tail.insert(0, messages[i])
                    tail_chars += len(_msg_content(messages[i]))
                    i -= 1
                messages = keep + tail
                logger.info(f"[UnifiedAnalyzer] Context trimmed: {len(messages)} msgs, ~{sum(len(_msg_content(m)) for m in messages)} chars")

            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                tools=tools,
                tool_choice="auto",
                temperature=0.1,
            )
            msg = response.choices[0].message
            logger.info(f"[UnifiedAnalyzer] Round {round_num+1}: "
                        f"tool_calls={len(msg.tool_calls) if msg.tool_calls else 0}, "
                        f"content_len={len(msg.content) if msg.content else 0}")

            if msg.tool_calls:
                messages.append(msg)

                def _parse_args(raw_args: str) -> dict:
                    """Parse LLM tool call args, fixing invalid escape sequences."""
                    try:
                        return json.loads(raw_args)
                    except json.JSONDecodeError:
                        return json.loads(self._sanitize_json_escapes(raw_args))

                # If any tool call is finish, process immediately and return
                for tc in msg.tool_calls:
                    if tc.function.name == "finish":
                        args = _parse_args(tc.function.arguments)
                        progress("分析完成" if is_zh else "Analysis complete")
                        return args.get("result", {})

                # Execute ALL tool calls concurrently, then send results together
                async def _exec_one(tc):
                    func_name = tc.function.name
                    args = _parse_args(tc.function.arguments)
                    if func_name == "list_dir":
                        path = args.get("path", ".")
                        progress(f"浏览目录: {path}" if is_zh else f"Listing: {path}")
                        result = self._tool_list_dir(project_path, path)
                    elif func_name == "read_file":
                        path = args.get("path", "")
                        progress(f"读取文件: {path}" if is_zh else f"Reading: {path}")
                        result = await self._tool_read_file(
                            project_path, path, args.get("intent", ""))
                    else:
                        result = f"Unknown tool: {func_name}"
                    return (tc, result)

                tasks = [_exec_one(tc) for tc in msg.tool_calls]
                tool_results = await asyncio.gather(*tasks)

                for tc, result in tool_results:
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": result,
                    })
            elif msg.content:
                # LLM returned text — try as JSON, otherwise prompt to use tools
                raw = msg.content.strip()
                try:
                    progress("分析完成" if is_zh else "Analysis complete")
                    return await self._loads_json_with_repair(raw, "final result")
                except Exception:
                    logger.warning(f"[UnifiedAnalyzer] LLM text (not tool call): {raw[:200]}")
                    messages.append({"role": "assistant", "content": raw[:200]})
                    messages.append({"role": "user", "content": "请使用工具探索项目，不要直接回答。调用 list_dir 或 read_file，完成后调用 finish。"})
            else:
                logger.warning("[UnifiedAnalyzer] Empty LLM response, retrying")
                messages.append({"role": "user", "content": "请选择一个工具调用。"})

        return {}

    # ── Sub-agent: discover boundaries from file tree ──

    async def _discover_boundaries(self, project_path: str, language: str = "en",
                                     on_progress=None) -> dict:
        """Phase 1: LLM uses list_dir/read_file tools to explore and identify boundaries."""
        lang_label = "中文" if language == "zh" else "English"
        project_name = os.path.basename(project_path)

        system_prompt = f"使用{lang_label}输出。\n{BOUNDARY_DISCOVERY_PROMPT}"
        user_msg = f"项目: {project_name}\n路径: {project_path}\n\n先从 list_dir('.') 开始探索项目结构。"

        return await self._tool_loop(project_path, system_prompt, user_msg,
                                     DISCOVERY_TOOLS, max_rounds=10, language=language,
                                     on_progress=on_progress)

    # ── Sub-agent: analyze one boundary ──

    async def _analyze_boundary(self, boundary: dict, project_path: str,
                                 language: str = "en", on_progress=None) -> dict:
        """Phase 2: LLM reads files and returns level-2 features for this boundary. Steps are lazy-loaded."""
        lang_label = "中文" if language == "zh" else "English"

        blabel = boundary.get("label", "Unknown")
        bdesc = boundary.get("description", "")
        entry_files = boundary.get("entry_files") or boundary.get("files") or []

        system_prompt = f"使用{lang_label}输出。\n{BOUNDARY_ANALYSIS_PROMPT}"
        user_msg = (
            f"边界: {blabel}\n描述: {bdesc}\n"
            f"入口文件: {', '.join(entry_files[:3])}\n\n"
            f"从入口文件开始，用 read_file 读取并分析。"
        )

        return await self._tool_loop(project_path, system_prompt, user_msg,
                                     ANALYSIS_TOOLS, max_rounds=8, language=language,
                                     on_progress=on_progress)

    # ── Incremental refresh ──

    def _scan_changed_files(self, project_path: str, since_timestamp: str | None) -> list[str]:
        """Scan project and return relative paths of files modified since the given timestamp.
        Returns empty list if timestamp is None (meaning first analysis)."""
        if not since_timestamp:
            return []  # first analysis, no baseline to compare
        try:
            since = datetime.fromisoformat(since_timestamp).timestamp()
        except (ValueError, TypeError):
            return []

        changed: list[str] = []
        source_exts = {".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".java",
                       ".json", ".toml", ".yaml", ".yml", ".md", ".css", ".html", ".vue", ".svelte"}
        root = Path(project_path)

        def scan(current: Path, depth: int):
            if depth > 4:
                return
            try:
                for item in sorted(current.iterdir()):
                    name = item.name
                    if name.startswith(".") and name not in (".env.example",):
                        continue
                    if item.is_dir():
                        if name in IGNORE_DIRS:
                            continue
                        scan(item, depth + 1)
                    elif item.is_file():
                        ext = item.suffix.lower()
                        if ext not in source_exts:
                            continue
                        try:
                            mtime = item.stat().st_mtime
                        except OSError:
                            continue
                        if mtime > since:
                            rel = self._make_relative(str(item), project_path)
                            changed.append(rel)
            except PermissionError:
                pass

        scan(root, 1)
        return changed[:20]  # cap at 20 to avoid overwhelming the LLM

    async def incremental_refresh(self, project_path: str, language: str = "en"):
        """Incremental refresh: detect changed files, update only what's needed.
        Falls back to full analysis if too many changes or first analysis."""
        is_zh = language == "zh"

        # Check existing features
        from services.db import load_features, get_meta, set_meta
        existing = load_features(project_path)
        last_analysis = get_meta(project_path, "last_analysis")

        changed = self._scan_changed_files(project_path, last_analysis)

        logger.info(f"[UnifiedAnalyzer] Incremental: {len(existing)} existing features, "
                    f"last_analysis={last_analysis}, changed_files={len(changed)}")

        # Decide: full vs incremental
        if not existing or not last_analysis or len(changed) > 5:
            reason = "first analysis" if not existing else "too many changes" if len(changed) > 5 else "no baseline"
            yield {"event": "progress", "data": json.dumps({
                "step": "start",
                "label": f"需要全量分析 ({reason})" if is_zh else f"Full analysis needed ({reason})",
            }, ensure_ascii=False)}
            async for ev in self.analyze_all_stream(project_path, language):
                yield ev
            return

        if not changed:
            yield {"event": "progress", "data": json.dumps({
                "step": "start",
                "label": "没有文件变更，地图已是最新" if is_zh else "No files changed, map is up to date",
            }, ensure_ascii=False)}
            yield {"event": "done", "data": json.dumps({
                "features": existing,
                "stats": {"message": "up_to_date"},
            }, ensure_ascii=False)}
            return

        # Incremental: analyze only changed files
        yield {"event": "progress", "data": json.dumps({
            "step": "discover",
            "label": f"检测到 {len(changed)} 个文件变更，增量更新中..." if is_zh else f"Detected {len(changed)} changed files, updating incrementally...",
            "detail": ", ".join(changed[:5])
        }, ensure_ascii=False)}

        # Read changed files
        file_contents = []
        for fp in changed:
            full = os.path.join(project_path, fp)
            if os.path.isfile(full):
                content = self._read_file(full)
                file_contents.append(f"=== {fp} ===\n{content}")
        files_text = "\n\n".join(file_contents)
        if len(files_text) > 12000:
            files_text = files_text[:12000] + "\n... (truncated)"

        # Build prompt with existing features + changed files
        features_json = json.dumps(existing, ensure_ascii=False, indent=2)[:4000]

        prompt = INCREMENTAL_PROMPT.format(
            current_features=features_json,
            change_summary=f"{len(changed)} files changed: {', '.join(changed[:8])}",
            file_contents=files_text,
        )

        yield {"event": "progress", "data": json.dumps({
            "step": "analyze",
            "label": "AI 正在评估变更影响..." if is_zh else "AI evaluating changes...",
        }, ensure_ascii=False)}

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "system", "content": prompt}],
                temperature=0.1,
            )
            raw = response.choices[0].message.content or "{}"
            data = self._loads_json_with_repair(raw, "incremental update")
            updates = data.get("updates", [])
            message = data.get("message", "")

            # Apply updates
            from services.db import find_feature, upsert_feature
            for update in updates:
                action = update.get("action")
                if action == "add_feature":
                    feat = update.get("feature", {})
                    if feat.get("id"):
                        feat["project_path"] = project_path
                        feat["level"] = 1
                        feat["files"] = [self._make_relative(f, project_path) for f in feat.get("files", [])]
                        upsert_feature(project_path, feat)
                elif action == "update_feature":
                    feat = update.get("feature", {})
                    fid = feat.get("id")
                    if fid:
                        item = find_feature(project_path, fid)
                        if item:
                            item.update({k: v for k, v in feat.items() if v})
                            if "files" in feat:
                                item["files"] = [self._make_relative(f, project_path) for f in feat["files"]]
                            save_features(project_path, [f for f in existing if f["id"] != fid] + [item])
                elif action == "remove_feature":
                    fid = update.get("feature_id")
                    if fid:
                        existing = [f for f in existing if f["id"] != fid]
                        save_features(project_path, existing)

            logger.info(f"[UnifiedAnalyzer] Incremental applied {len(updates)} updates: {message}")

            # Reload from DB after updates
            updated = load_features(project_path)
            set_meta(project_path, "last_analysis", datetime.now().isoformat())

            yield {"event": "progress", "data": json.dumps({
                "step": "save",
                "label": f"增量更新完成，{len(updates)} 处变更" if is_zh else f"Incremental done, {len(updates)} changes applied",
            }, ensure_ascii=False)}
            yield {"event": "done", "data": json.dumps({
                "features": updated,
                "stats": {"updates": len(updates), "message": message, "files_changed": len(changed)}
            }, ensure_ascii=False)}

        except Exception as e:
            logger.error(f"[UnifiedAnalyzer] Incremental failed: {e}", exc_info=True)
            yield {"event": "error", "data": json.dumps({"message": str(e)[:200]}, ensure_ascii=False)}
            # Fall back to full analysis
            yield {"event": "progress", "data": json.dumps({
                "step": "start",
                "label": "增量更新失败，切换到全量分析..." if is_zh else "Incremental failed, falling back to full analysis...",
            }, ensure_ascii=False)}
            async for ev in self.analyze_all_stream(project_path, language):
                yield ev

    # ── Main autonomous analysis ──

    async def analyze_all(self, project_path: str, language: str = "en") -> List[FeatureNode]:
        """Single autonomous agent: build tree, explore files, generate complete graph."""
        try:
            return await self._analyze_all_llm(project_path, language)
        except Exception as e:
            logger.error(f"[UnifiedAnalyzer] LLM analysis failed, using fallback: {e}", exc_info=True)
            file_tree = self._build_file_tree(project_path)
            return _fa._fallback_feature_tree(project_path, file_tree, str(e), language)

    async def _analyze_all_llm(self, project_path: str, language: str = "en") -> List[FeatureNode]:
        """Non-streaming version: collect results from streaming implementation."""
        root_node = None
        async for event in self._analyze_all_stream_impl(project_path, language):
            if event["event"] == "done":
                data = json.loads(event["data"])
                features = data.get("features", [])
                if features:
                    root_node = FeatureNode(**features[0])
        if root_node:
            return [root_node]
        return []

    async def analyze_all_stream(self, project_path: str, language: str = "en"):
        """Streaming version: yield progress events as SSE dicts, last event = done."""
        is_zh = language == "zh"
        logger.info("[UnifiedAnalyzer] analyze_all_stream START")
        yield {"event": "progress", "data": json.dumps({"step": "start", "label": "开始分析..."}, ensure_ascii=False)}
        logger.info("[UnifiedAnalyzer] analyze_all_stream first yield done")
        try:
            async for event in self._analyze_all_stream_impl(project_path, language):
                yield event
        except Exception as e:
            logger.error(f"[UnifiedAnalyzer] Stream analysis failed: {e}", exc_info=True)
            yield {"event": "error", "data": json.dumps({"message": str(e)[:200]}, ensure_ascii=False)}
            # Fallback
            file_tree = self._build_file_tree(project_path)
            nodes = _fa._fallback_feature_tree(project_path, file_tree, str(e), language)
            yield {"event": "done", "data": json.dumps({"features": [n.model_dump() for n in nodes]}, ensure_ascii=False)}

    async def _analyze_single_boundary(self, boundary: dict, project_path: str,
                                       language: str, index: int, total: int) -> dict:
        """Analyze one boundary — generates level-2 features only. Steps are lazy-loaded on demand."""
        is_zh = language == "zh"
        bid = boundary.get("id", f"grp_{index}")
        blabel = boundary.get("label", f"Boundary {index+1}")
        entry_files = boundary.get("entry_files") or boundary.get("files") or []

        tool_events: list = []
        def on_progress(event):
            tool_events.append(event)

        result = await self._analyze_boundary(boundary, project_path, language, on_progress=on_progress)
        features_data = result.get("features", [])

        # Build FeatureNodes — level 2 only, no steps (lazy-loaded via drill_down)
        feature_nodes = []
        for f in features_data:
            f_files = [self._make_relative(fp, project_path) for fp in f.get("files", [])]
            feature_nodes.append(FeatureNode(
                id=f["id"], label=f["label"], level=2,
                parent_id=bid,
                description=f.get("description", ""),
                flow_description=f.get("flow_description", ""),
                files=f_files, functions=f.get("functions", []),
                children=[],  # empty — expanded on demand
            ))

        group_node = FeatureNode(
            id=bid, label=blabel, level=1,
            parent_id="project_overview",
            description=boundary.get("description", ""),
            flow_description="",
            files=entry_files, functions=[],
            children=feature_nodes, generated=True,
        )

        logger.info(f"[UnifiedAnalyzer] Boundary {index+1}/{total} '{blabel}' done: "
                    f"{len(feature_nodes)} features, {len(tool_events)} tool_events")
        return {
            "index": index,
            "label": blabel,
            "group_node": group_node,
            "feature_count": len(feature_nodes),
            "tool_events": tool_events,
            "entry_files": entry_files,
        }

    async def _analyze_all_stream_impl(self, project_path: str, language: str = "en"):
        is_zh = language == "zh"
        project_name = os.path.basename(project_path)

        # Step 1: Build file tree
        yield {"event": "progress", "data": json.dumps({
            "step": "tree", "label": "正在扫描项目文件..." if is_zh else "Scanning project files...",
        }, ensure_ascii=False)}

        # Step 2: Discover boundaries (Phase 1)
        yield {"event": "progress", "data": json.dumps({
            "step": "discover", "label": "AI 正在探索项目结构..." if is_zh else "AI exploring project structure...",
        }, ensure_ascii=False)}

        tool_events: list = []

        def on_progress(event):
            tool_events.append(event)

        discovery = await self._discover_boundaries(project_path, language, on_progress=on_progress)
        for ev in tool_events:
            yield ev
        boundaries = discovery.get("boundaries", [])
        overview_data = discovery.get("project_overview", {})

        if not boundaries:
            logger.warning("[UnifiedAnalyzer] No boundaries discovered, falling back to static analysis")
            file_tree = self._build_file_tree(project_path)
            nodes = _fa._fallback_feature_tree(project_path, file_tree, "No boundaries discovered", language)
            yield {"event": "done", "data": json.dumps({"features": [n.model_dump() for n in nodes]}, ensure_ascii=False)}
            return

        yield {"event": "progress", "data": json.dumps({
            "step": "discover", "label": f"发现 {len(boundaries)} 个边界" if is_zh else f"Found {len(boundaries)} boundaries",
            "detail": ", ".join(b.get("label", "?") for b in boundaries)
        }, ensure_ascii=False)}

        # Step 3: Analyze each boundary in parallel (Phase 2)
        # All boundaries are independent — analyze them concurrently via asyncio.gather
        bound_count = len(boundaries)
        yield {"event": "progress", "data": json.dumps({
            "step": "analyze",
            "label": f"AI 并行分析 {bound_count} 个边界..." if is_zh else f"AI analyzing {bound_count} boundaries in parallel...",
            "detail": ", ".join(b.get("label", "?") for b in boundaries)
        }, ensure_ascii=False)}

        # Launch all boundary analyses concurrently
        tasks = [
            self._analyze_single_boundary(boundary, project_path, language, i, bound_count)
            for i, boundary in enumerate(boundaries)
        ]
        results = await asyncio.gather(*tasks)

        # Sort by original index to preserve boundary order, then stream tool events
        results.sort(key=lambda r: r["index"])

        all_group_nodes = []
        total_features = 0

        for r in results:
            yield {"event": "progress", "data": json.dumps({
                "step": "analyze",
                "label": f"{'完成分析' if is_zh else 'Done'}: {r['label']} ({r['feature_count']} features)",
                "detail": ", ".join(r["entry_files"][:3])
            }, ensure_ascii=False)}
            for ev in r["tool_events"]:
                yield ev
            all_group_nodes.append(r["group_node"])
            total_features += r["feature_count"]

        if not all_group_nodes:
            logger.warning("[UnifiedAnalyzer] No group nodes built, falling back to static analysis")
            file_tree = self._build_file_tree(project_path)
            nodes = _fa._fallback_feature_tree(project_path, file_tree, "No features generated", language)
            yield {"event": "done", "data": json.dumps({"features": [n.model_dump() for n in nodes]}, ensure_ascii=False)}
            return

        # Step 4: Build root and save
        yield {"event": "progress", "data": json.dumps({
            "step": "save", "label": "正在构建地图..." if is_zh else "Building feature map...",
        }, ensure_ascii=False)}

        root = FeatureNode(
            id="project_overview",
            label=overview_data.get("label", "Entry Map"),
            level=0,
            description=overview_data.get("description", ""),
            flow_description=overview_data.get("flow_description", ""),
            files=[], functions=[],
            children=all_group_nodes, generated=True,
        )
        self._validate_tree(root)
        save_features(project_path, [root.model_dump()])
        # Record last analysis time for incremental update detection
        from services.db import set_meta
        set_meta(project_path, "last_analysis", datetime.now().isoformat())

        yield {"event": "done", "data": json.dumps({
            "features": [root.model_dump()],
            "stats": {"groups": len(boundaries), "features": total_features}
        }, ensure_ascii=False)}


unified_analyzer = UnifiedAnalyzer()
