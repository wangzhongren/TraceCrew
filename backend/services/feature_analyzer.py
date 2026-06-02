import ast
import json
import logging
import os
import re
from typing import List

from openai import AsyncOpenAI

from models.feature import FeatureNode
from services.db import load_features, save_features, find_feature, update_feature_children

logger = logging.getLogger("codeatlas.feature_analyzer")

LEVEL1_PROMPT = """你是一个代码架构分析师。请基于提供的文件内容分析项目，输出入口驱动的思维导图。

【证据规则——严禁编造】
1. 你只能基于代码中实际存在的文件、函数、类来生成 feature
2. files 必须是代码中真实存在的文件路径，函数名必须是代码中实际定义的
3. 地图必须从入口文件开始展开，而不是按目录机械分组
4. 第一层 groups 表示运行时边界/系统边界，例如 Electron 主进程、React 渲染进程、FastAPI 后端、CLI、数据层
5. 第二层 features 表示入口点或从入口直接控制的关键模块，例如 main.ts、App.tsx、main.py、路由注册、IPC 注册
6. 如果代码量很少或结构简单，减少 groups/features 数量，甚至可以只输出 1 个 group
7. 不确定的东西不要写，宁可少也不要编
8. flow_description 要基于代码逻辑来写，不要凭空想象

【输出格式】纯 JSON：
{
  "project_overview": {
    "label": "Entry Map",
    "description": "一句话描述项目入口和运行时边界（基于代码，不臆测）",
    "flow_description": "从入口展开的架构概述（基于代码）"
  },
  "groups": [
    {
      "id": "grp_xxx",
      "label": "运行时边界名",
      "description": "这个边界在系统里的职责",
      "features": [
        {
          "id": "feat_xxx",
          "label": "入口点或关键模块名",
          "description": "这个入口点/模块具体做什么",
          "flow_description": "从该入口继续展开的调用/控制流概述",
          "files": ["实际存在的文件路径"],
          "functions": ["实际定义的函数名:行号"]
        }
      ]
    }
  ]
}

【规则】
- groups 1-5 个，优先对应真实运行时边界
- features 1-5 个每组，优先选择入口文件、路由注册、组件根、IPC 注册、命令入口
- id 用英文短标识
- 行号必须从代码行号标注中获取"""

OVERVIEW_PROMPT = """你是一个项目架构分析师。你需要为项目或模块写一段详细的技术概述。

请根据文件内容和结构，输出：

【输出格式】纯 JSON：
{
  "description": "2-3句话描述这个模块的核心职责",
  "overview": "详细的技术概述，包含：\n1. 这个模块/项目是做什么的\n2. 核心技术方案和架构设计\n3. 主要功能组件之间如何协作\n4. 数据流和控制流概要\n用 markdown 风格书写，自然段落",
  "files": ["关键文件路径"],
  "functions": ["关键函数名:行号"]
}"""

LEVEL2_PROMPT = """你是一个代码流程分析师。用户正在钻取一个功能点，你需要画出这个功能内部的详细流程步骤。

上级功能信息：
{parent_context}

相关文件内容：
{file_contents}

请分析这些代码，生成该功能的内部流程步骤。

【输出格式】纯 JSON：
{
  "steps": [
    {
      "id": "步骤标识(拼在父级id后面，如 parent_id.login_handler)",
      "label": "步骤名称(中文)",
      "description": "这个步骤做什么",
      "flow_description": "这个步骤内部的具体实现细节描述",
      "files": ["具体到这个步骤的文件"],
      "functions": ["函数名:行号"],  // 必须带行号，如 "login:42", "verifyToken:58"
    }
  ]
}

【规则——证据优先】
- 只基于提供的文件内容生成步骤，不编造不存在的函数和文件
- files 和 functions 必须能在代码中找到
- 行号从代码标注中获取，不确定就不写
- 步骤数量视实际代码复杂度而定，2-8 个即可
- files 和 functions 要尽可能具体
- functions 必须带行号，格式: "函数名:行号"
- 代码中每行前面有 "行号|" 标注，直接用那个行号，如代码里 "  42| def login():" 就写 "login:42"
- 行号必须准确，不要瞎编"""

INCREMENTAL_PROMPT = """你是一个代码架构维护助手。项目代码发生了一些变更，你需要增量更新功能点图谱。

【当前功能图谱】
{current_features}

【代码变更摘要】
{change_summary}

【变更涉及的文件内容】
{file_contents}

请分析这些变更对功能点的影响，返回需要增量更新的操作。

【输出格式】纯 JSON：
{
  "message": "简述变更影响",
  "updates": [
    { "action": "add_feature", "feature": { "id": "新功能id", "label": "功能名", "description": "描述", "flow_description": "流程概述", "files": ["文件路径"], "functions": ["函数名:行号"] } },
    { "action": "update_feature", "feature": { "id": "已有功能id", "description": "更新的描述", "files": ["更新的文件"], "functions": ["更新的函数"] } },
    { "action": "remove_feature", "feature_id": "要删除的功能id" }
  ]
}

【规则——证据优先】
- 只返回真正受影响的变更，变更很小则返回空 updates
- files 和 functions 必须从代码内容中获取，不编造
- 行号从代码标注获取，不确定就不写"""

LEVEL3_PROMPT = """你是一个代码细节分析专家。用户正在查看一个流程步骤的具体实现。

步骤信息：{parent_context}

相关代码：
{file_contents}

请分析这段代码的具体实现细节。

【输出格式】纯 JSON：
{
  "details": [
    {
      "id": "细节标识",
      "label": "细节名称",
      "description": "这段代码的具体逻辑和关键实现细节",
      "files": ["文件路径"],
      "functions": ["函数名:行号"],
      "flow_description": ""
    }
  ]
}"""


class FeatureAnalyzer:
    def __init__(self):
        self.client = AsyncOpenAI(
            api_key=os.getenv("CODEATLAS_LLM_API_KEY"),
            base_url=os.getenv("CODEATLAS_LLM_BASE_URL"),
        )
        self.model = os.getenv("CODEATLAS_LLM_MODEL")

    def _clean(self, raw: str) -> str:
        raw = raw.strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        return raw.strip()

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

    def _loads_json_object(self, raw: str) -> dict:
        return json.loads(self._extract_json_object(raw))

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

    async def _loads_json_object_with_repair(self, raw: str, purpose: str) -> dict:
        try:
            return self._loads_json_object(raw)
        except Exception as exc:
            logger.warning("[FeatureAnalyzer] JSON parse failed for %s: %s", purpose, exc)
            return await self._repair_json_object(raw, purpose)

    def _read_file(self, filepath: str) -> str:
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                lines = f.readlines()
            # Prepend line numbers so LLM can reference exact positions
            numbered = []
            for i, line in enumerate(lines, 1):
                numbered.append(f"{i:4d}| {line.rstrip()}")
            content = "\n".join(numbered)
            if len(content) > 8000:
                half = 4000
                content = content[:half] + "\n    ...(truncated)...\n" + content[-half:]
            return content
        except Exception:
            return f"[无法读取: {filepath}]"

    def _make_relative(self, filepath: str, project_path: str) -> str:
        """Convert absolute path to relative from project root."""
        try:
            pp = os.path.normpath(project_path)
            fp = os.path.normpath(filepath)
            if fp.lower().startswith(pp.lower()):
                rel = os.path.relpath(fp, pp)
                return rel.replace('\\', '/')
        except Exception:
            pass
        return filepath.replace('\\', '/')

    def _find_key_files(self, file_tree: list, project_path: str) -> list[str]:
        """Auto-discover important files to read for context."""
        key_patterns = [
            'package.json', 'README.md', 'setup.py', 'pyproject.toml',
            'main.py', 'app.py', 'index.ts', 'index.tsx', 'main.ts',
            'Cargo.toml', 'go.mod', 'Makefile', 'Dockerfile',
            'src/index', 'src/main', 'src/app',
        ]
        key_files: list[str] = []

        def walk(entries: list, depth: int = 0):
            if depth > 3:
                return
            for e in entries:
                if e.get('type') == 'file':
                    name = e.get('name', '')
                    path_str = e.get('path', '')
                    for pat in key_patterns:
                        if pat in name or pat in path_str:
                            key_files.append(self._make_relative(path_str, project_path))
                            break
                if e.get('type') == 'directory' and e.get('children'):
                    walk(e['children'], depth + 1)

        walk(file_tree)
        seen = set()
        result = []
        for f in key_files:
            if f not in seen:
                seen.add(f)
                result.append(f)
        return result[:15]

    def _fallback_symbols(self, full_path: str) -> list[str]:
        return [f"{item['name']}:{item['line']}" for item in self._fallback_function_details(full_path)[:12]]

    def _describe_symbol(self, name: str, preview: str, language: str = "en") -> str:
        lower = f"{name} {preview}".lower()
        is_zh = language == "zh"
        checks = [
            ("health", "健康检查接口，用来确认后端服务是否可用。" if is_zh else "Health-check endpoint used to confirm that the backend is available."),
            ("chat", "Agent 聊天入口，负责接收用户请求并调用 Agent 服务。" if is_zh else "Agent chat entry that receives user requests and delegates to the agent service."),
            ("stream", "流式响应入口，用于把长任务或模型输出逐步推送给前端。" if is_zh else "Streaming response entry that pushes long-running output or model tokens to the frontend."),
            ("feature", "地图/功能树相关入口，负责生成、读取或更新代码地图。" if is_zh else "Feature-map entry responsible for generating, reading, or updating the code map."),
            ("analyze", "分析入口，负责读取代码证据并生成结构化节点。" if is_zh else "Analysis entry that reads code evidence and produces structured map nodes."),
            ("window", "窗口控制分支，负责桌面窗口的创建、关闭或状态切换。" if is_zh else "Window-control branch for creating, closing, or toggling the desktop window."),
            ("ipc", "IPC 注册/处理分支，连接渲染进程和 Electron 主进程能力。" if is_zh else "IPC registration or handling branch connecting renderer requests to Electron main-process capabilities."),
            ("shell", "Shell 执行分支，负责启动、跟踪或停止本地命令。" if is_zh else "Shell execution branch responsible for starting, tracking, or stopping local commands."),
            ("backend", "后端生命周期分支，负责启动、检测或停止本地后端服务。" if is_zh else "Backend lifecycle branch responsible for starting, checking, or stopping the local backend service."),
            ("file", "文件系统操作分支，负责读取、写入、备份或恢复项目文件。" if is_zh else "File-system branch responsible for reading, writing, backing up, or restoring project files."),
            ("project", "项目状态分支，负责打开项目、保存路径或刷新项目上下文。" if is_zh else "Project-state branch responsible for opening projects, saving paths, or refreshing project context."),
            ("render", "界面渲染分支，负责组织 UI 状态和组件展示。" if is_zh else "UI rendering branch responsible for organizing interface state and component display."),
        ]
        for token, description in checks:
            if token in lower:
                return description
        return (
            f"从函数名和定义行推断的分支函数：`{name}`。建议点击跳转到源码确认细节。"
            if is_zh else
            f"Branch function inferred from its name and definition line: `{name}`. Click through to verify details in source."
        )

    def _fallback_function_details(self, full_path: str, language: str = "en") -> list[dict]:
        if full_path.endswith(".py"):
            try:
                with open(full_path, "r", encoding="utf-8") as f:
                    source = f.read()
                    tree = ast.parse(source)
            except Exception:
                return []

            details = []
            nodes = [
                node for node in ast.walk(tree)
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
            ]
            for node in sorted(nodes, key=lambda n: n.lineno):
                doc = ast.get_docstring(node) or ""
                preview = doc.splitlines()[0] if doc else node.name
                details.append({
                    "name": node.name,
                    "line": node.lineno,
                    "kind": "class" if isinstance(node, ast.ClassDef) else "function",
                    "description": self._describe_symbol(node.name, preview, language),
                })
                if len(details) >= 12:
                    break
            return details

        try:
            with open(full_path, "r", encoding="utf-8") as f:
                lines = f.readlines()
        except Exception:
            return []

        details = []
        patterns = [
            re.compile(r"^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\("),
            re.compile(r"^\s*class\s+([A-Za-z_][\w]*)\b"),
            re.compile(r"^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\("),
            re.compile(r"^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b"),
            re.compile(r"^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\("),
        ]
        for idx, line in enumerate(lines, 1):
            for pattern in patterns:
                match = pattern.match(line)
                if match:
                    name = match.group(1)
                    details.append({
                        "name": name,
                        "line": idx,
                        "kind": "class" if "class " in line else "function",
                        "description": self._describe_symbol(name, line.strip(), language),
                    })
                    break
            if len(details) >= 12:
                break
        return details

    def _fallback_feature_tree(self, project_path: str, file_tree: list, reason: str = "", language: str = "en") -> List[FeatureNode]:
        """Generate an entry-driven mind map when LLM analysis is unavailable."""
        is_zh = language == "zh"
        source_exts = {".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".java"}
        config_names = {"README.md", "package.json", "pyproject.toml", "go.mod", "Cargo.toml", "Makefile", "Dockerfile"}
        all_files: list[str] = []

        def walk(entries: list, depth: int = 0):
            if depth > 5:
                return
            for entry in entries or []:
                if entry.get("type") == "file":
                    rel = self._make_relative(entry.get("path", ""), project_path)
                    _, ext = os.path.splitext(rel)
                    if ext in source_exts or os.path.basename(rel) in config_names:
                        all_files.append(rel)
                elif entry.get("type") == "directory":
                    walk(entry.get("children", []), depth + 1)

        walk(file_tree)
        if not all_files:
            all_files = self._find_key_files(file_tree, project_path)

        seen_files = set()
        ordered_files = []
        for rel in all_files:
            if rel not in seen_files:
                seen_files.add(rel)
                ordered_files.append(rel)
        all_files = ordered_files

        def norm(rel: str) -> str:
            return rel.replace("\\", "/")

        def is_entry(rel: str) -> bool:
            r = norm(rel)
            base = os.path.basename(r)
            return (
                r == "backend/main.py"
                or r == "electron/main.ts"
                or r == "electron/backendLauncher.ts"
                or r == "frontend/src/main.tsx"
                or r == "frontend/src/App.tsx"
                or base in {"README.md", "package.json", "pyproject.toml", "go.mod", "Cargo.toml"}
                or base in {"main.py", "app.py", "main.ts", "main.tsx", "index.ts", "index.tsx"}
            )

        def boundary_for(rel: str) -> str:
            r = norm(rel)
            if r.startswith("electron/"):
                return "electron"
            if r.startswith("backend/"):
                return "backend"
            if r.startswith("frontend/"):
                return "frontend"
            return "project"

        boundary_meta = {
            "electron": {
                "label": "Electron 主进程" if is_zh else "Electron Main Process",
                "description": "桌面壳、窗口生命周期、IPC 桥接、后端进程生命周期和 Shell 执行边界。" if is_zh else "Desktop shell, window lifecycle, IPC bridge, backend process lifecycle, and shell execution boundary.",
            },
            "backend": {
                "label": "FastAPI 后端" if is_zh else "FastAPI Backend",
                "description": "提供 Agent 聊天、地图分析、地图搜索、拓扑更新和项目数据持久化的 HTTP API。" if is_zh else "HTTP APIs for agent chat, feature analysis, map search, topology updates, and persisted project data.",
            },
            "frontend": {
                "label": "React 渲染界面" if is_zh else "React Renderer",
                "description": "交互式 IDE 界面：项目浏览、代码查看、地图树、详情面板和聊天 Agent。" if is_zh else "Interactive IDE surface: project explorer, code viewer, feature tree, details panel, and chat agent UI.",
            },
            "project": {
                "label": "项目定义" if is_zh else "Project Definition",
                "description": "仓库级配置、文档、包元数据和运行说明。" if is_zh else "Repository-level configuration, documentation, package metadata, and run instructions.",
            },
        }

        def label_for_entry(rel: str) -> str:
            r = norm(rel)
            labels = {
                "backend/main.py": "后端 API 入口" if is_zh else "Backend API Entry",
                "electron/main.ts": "Electron 应用入口" if is_zh else "Electron App Entry",
                "electron/backendLauncher.ts": "后端生命周期入口" if is_zh else "Backend Lifecycle Entry",
                "frontend/src/main.tsx": "React 挂载入口" if is_zh else "React Mount Entry",
                "frontend/src/App.tsx": "IDE 布局入口" if is_zh else "IDE Layout Entry",
                "README.md": "产品与运行指南" if is_zh else "Product & Run Guide",
                "frontend/package.json": "前端脚本" if is_zh else "Frontend Scripts",
            }
            return labels.get(r, os.path.basename(r))

        def node_id(prefix: str, rel: str) -> str:
            slug = re.sub(r"[^a-zA-Z0-9_]+", "_", rel).strip("_").lower()
            return f"{prefix}_{slug or 'root'}"

        entries_by_boundary: dict[str, list[str]] = {key: [] for key in boundary_meta}
        support_by_boundary: dict[str, list[str]] = {key: [] for key in boundary_meta}
        for rel in all_files:
            boundary = boundary_for(rel)
            if is_entry(rel):
                entries_by_boundary[boundary].append(rel)
            else:
                support_by_boundary[boundary].append(rel)

        for boundary, files in list(support_by_boundary.items()):
            if not entries_by_boundary[boundary] and files:
                entries_by_boundary[boundary].append(files[0])
                support_by_boundary[boundary] = files[1:]

        boundary_nodes = []
        for boundary in ["project", "electron", "backend", "frontend"]:
            entries = entries_by_boundary[boundary]
            support = support_by_boundary[boundary]
            if not entries and not support:
                continue

            entry_nodes = []
            for entry in entries[:5]:
                related = support[:5]
                child_nodes = []
                full = os.path.join(project_path, entry)
                function_details = self._fallback_function_details(full, language)
                for detail in function_details[:8]:
                    fn_ref = f"{detail['name']}:{detail['line']}"
                    child_nodes.append(FeatureNode(
                        id=node_id("branch", f"{entry}_{detail['name']}_{detail['line']}"),
                        label=detail["name"],
                        level=3,
                        parent_id=node_id("entry", entry),
                        description=detail["description"],
                        flow_description=(
                            f"这是入口文件 `{entry}` 下的分支函数。点击函数可跳转到定义位置。"
                            if is_zh else
                            f"This is a branch function under entry file `{entry}`. Click the function to jump to its definition."
                        ),
                        files=[entry],
                        functions=[fn_ref],
                        generated=True,
                    ))
                for rel in related:
                    full = os.path.join(project_path, rel)
                    symbols = self._fallback_symbols(full)
                    child_nodes.append(FeatureNode(
                        id=node_id("module", f"{entry}_{rel}"),
                        label=os.path.basename(rel),
                        level=3,
                        parent_id=node_id("entry", entry),
                        description=(f"来自 {rel} 的支撑实现证据。" if is_zh else f"Supporting implementation evidence from {rel}."),
                        flow_description=("打开这个文件查看细节；该节点由静态文件和符号证据生成。" if is_zh else "Open this file to inspect details; generated from static file and symbol evidence."),
                        files=[rel],
                        functions=symbols,
                        generated=True,
                    ))

                symbols = [f"{item['name']}:{item['line']}" for item in function_details[:12]]
                function_summary = "\n".join(
                    f"- `{item['name']}:{item['line']}`: {item['description']}"
                    for item in function_details[:8]
                )
                entry_nodes.append(FeatureNode(
                    id=node_id("entry", entry),
                    label=label_for_entry(entry),
                    level=2,
                    parent_id=f"boundary_{boundary}",
                    description=(f"来自 {entry} 的入口证据。" if is_zh else f"Entry evidence from {entry}."),
                    flow_description=(
                        (
                            f"从这里开始查看「{boundary_meta[boundary]['label']}」分支。这个节点是入口点；下面列出入口文件中的主要分支函数。\n\n{function_summary}"
                            if function_summary else
                            f"从这里开始查看「{boundary_meta[boundary]['label']}」分支。这个节点是入口点；继续展开支撑文件可以沿实现向外追踪。"
                        )
                        if is_zh else
                        (
                            f"Start here for the {boundary_meta[boundary]['label']} branch. This node is an entry point; below are the main branch functions discovered in the entry file.\n\n{function_summary}"
                            if function_summary else
                            f"Start here for the {boundary_meta[boundary]['label']} branch. "
                            "This node is an entry point; expand supporting files to follow the implementation outward."
                        )
                    ),
                    files=[entry],
                    functions=symbols,
                    children=child_nodes,
                    generated=True,
                ))

            boundary_files = entries + support[:8]
            boundary_nodes.append(FeatureNode(
                id=f"boundary_{boundary}",
                label=boundary_meta[boundary]["label"],
                level=1,
                parent_id="project_overview",
                description=boundary_meta[boundary]["description"],
                flow_description=(
                    "从文件结构和代码符号生成的入口驱动分支。可以按「边界 -> 入口 -> 支撑实现」的路径理解项目。"
                    if is_zh else
                    "Entry-driven branch generated from file structure and code symbols. "
                    "Use this as a mind-map path: boundary -> entry -> supporting implementation."
                ),
                files=boundary_files,
                functions=[],
                children=entry_nodes,
                generated=True,
            ))

        root = FeatureNode(
            id="project_overview",
            label="入口地图" if is_zh else "Entry Map",
            level=0,
            description="基于静态证据生成的入口驱动项目地图。" if is_zh else "Entry-driven project map generated from static evidence.",
            flow_description=(
                (
                    "CodeAtlas 会先识别仓库入口点，再展开到运行时边界和支撑实现文件。"
                    "这样地图更像思维导图，而不是目录列表。"
                    + (f"\n\n兜底原因: {reason[:300]}" if reason else "")
                )
                if is_zh else
                (
                    "CodeAtlas starts from repository entry points and expands into runtime boundaries, "
                    "then supporting implementation files. This keeps the map closer to a mind map than a directory listing."
                    + (f"\n\nFallback reason: {reason[:300]}" if reason else "")
                )
            ),
            files=[],
            functions=[],
            children=boundary_nodes,
            generated=True,
        )
        save_features(project_path, [root.model_dump()])
        logger.info(f"[FeatureAnalyzer] Entry fallback generated {len(boundary_nodes)} boundaries")
        return [root]

    async def analyze_top_level(self, project_path: str, file_tree: list, language: str = "en") -> List[FeatureNode]:
        """Autonomous agent: explore project files, then generate feature tree."""
        try:
            return await self._analyze_top_level_llm(project_path, file_tree, language)
        except Exception as e:
            logger.error(f"[FeatureAnalyzer] LLM top-level analysis failed, using fallback: {e}", exc_info=True)
            return self._fallback_feature_tree(project_path, file_tree, str(e), language)

    async def _analyze_top_level_llm(self, project_path: str, file_tree: list, language: str = "en") -> List[FeatureNode]:
        """Autonomous agent: explore project files with LLM, then generate feature tree."""
        tree_summary = json.dumps(file_tree, ensure_ascii=False, indent=2)[:4000]
        read_files: dict[str, str] = {}
        read_set: set[str] = set()
        initial_files = self._find_key_files(file_tree, project_path)[:8]
        for fp in initial_files:
            full = fp if os.path.isabs(fp) else os.path.join(project_path, fp)
            if os.path.isfile(full):
                rel = self._make_relative(full, project_path)
                read_set.add(rel)
                read_files[rel] = self._read_file(full)

        # Step 1: Agent loop — explore and read files
        explore_prompt = """你是项目探索助手。你要通过阅读文件内容来理解项目，不是凭文件名字猜测。

【证据规则】
1. 文件的名字只告诉你它可能存在，不能告诉你文件里写了什么
2. 你必须在看到文件内容之后才能对它的功能做判断
3. 优先读入口文件（main.py、index.ts、package.json、app.py 等）
4. 每次读 2-5 个文件，读完后判断是否还需要更多
5. 如果项目很小（<10 个源文件），可以直接全部读完
6. 最多 8 轮，信息够了就 done

【输出格式】纯 JSON：
{"action":"read","files":["路径1","路径2"],"reason":"读入口和配置文件了解项目结构"}
{"action":"done"}"""

        messages = [
            {"role": "system", "content": explore_prompt},
            {
                "role": "user",
                "content": (
                    f"项目: {os.path.basename(project_path)}\n文件树:\n{tree_summary}\n\n"
                    f"系统已预读入口候选文件: {', '.join(read_files.keys()) or '无'}。\n"
                    "如还需要更多支撑文件，请继续输出 read；够了输出 done。"
                ),
            },
        ]

        for round_num in range(8):
            response = await self.client.chat.completions.create(
                model=self.model, messages=messages,
                temperature=0.1,
            )
            raw = response.choices[0].message.content or "{}"
            data = await self._loads_json_object_with_repair(raw, "project exploration action")

            if data.get("action") == "done":
                logger.info(f"[FeatureAnalyzer] Agent done after {round_num + 1} rounds")
                break

            files_to_read = data.get("files", [])
            if not files_to_read:
                break

            new_content = ""
            for fp in files_to_read:
                if fp in read_set: continue
                read_set.add(fp)
                full = fp if os.path.isabs(fp) else os.path.join(project_path, fp)
                if os.path.isfile(full):
                    content = self._read_file(full)
                    read_files[fp] = content
                    new_content += f"\n\n=== {fp} ===\n{content}"

            if not new_content: break
            messages.append({"role": "assistant", "content": raw[:200]})
            messages.append({"role": "user", "content": f"读取了: {', '.join(files_to_read)}{new_content[:6000]}\n\n还需要更多吗？够了输出 done。"})

        # Step 2: Generate feature tree from explored files
        files_text = "\n\n".join(f"=== {k} ===\n{v}" for k, v in list(read_files.items())[:15])[:10000]

        user_msg = (
            f"项目路径: {project_path}\n\n"
            f"【输出语言】{'中文' if language == 'zh' else 'English'}\n"
            f"请让 label、description、flow_description 使用{'中文' if language == 'zh' else 'English'}。\n\n"
            f"【文件树】\n{tree_summary}\n\n"
            f"【探索到的文件内容】\n{files_text}\n\n"
            f"请基于以上代码内容生成功能树。"
        )

        response = await self.client.chat.completions.create(
            model=self.model, temperature=0.2,
            messages=[{"role": "system", "content": LEVEL1_PROMPT}, {"role": "user", "content": user_msg}],
        )

        raw = response.choices[0].message.content or "{}"
        data = await self._loads_json_object_with_repair(raw, "top-level feature map")

        overview_data = data.get("project_overview", {})
        groups_data = data.get("groups", [])

        root = FeatureNode(
            id="project_overview",
            label=overview_data.get("label", "项目总览"),
            level=0,
            description=overview_data.get("description", ""),
            flow_description=overview_data.get("flow_description", ""),
            files=[], functions=[],
        )

        group_nodes = []
        for g in groups_data:
            feature_nodes = []
            for f in g.get("features", []):
                normalized_files = [self._make_relative(fp, project_path) for fp in f.get("files", [])]
                feature_nodes.append(FeatureNode(
                    id=f["id"], label=f["label"], level=2, parent_id=g["id"],
                    description=f.get("description", ""), flow_description=f.get("flow_description", ""),
                    files=normalized_files, functions=f.get("functions", []),
                ))
            group_nodes.append(FeatureNode(
                id=g["id"], label=g["label"], level=1, parent_id="project_overview",
                description=g.get("description", ""), flow_description="",
                files=[], functions=[], children=feature_nodes, generated=True,
            ))

        root.children = group_nodes
        root.generated = True
        save_features(project_path, [root.model_dump()])

        logger.info(f"[FeatureAnalyzer] Generated: {len(groups_data)} groups, "
                    f"{sum(len(g.get('features',[])) for g in groups_data)} features, {len(read_files)} files read")
        return [root]

    async def generate_overview(self, project_path: str, node_id: str, files: list[str]) -> dict:
        """Generate a detailed overview for a project root or feature group."""
        logger.info(f"[FeatureAnalyzer] Generating overview for {node_id}")

        # If no files provided, auto-discover key files from project
        if not files:
            try:
                entries = os.listdir(project_path)
                for entry in entries[:30]:
                    fp = os.path.join(project_path, entry)
                    if os.path.isfile(fp) and not entry.startswith('.'):
                        files.append(entry)
            except Exception:
                pass

        file_contents = []
        for fp in (files or [])[:15]:
            full = fp if os.path.isabs(fp) else os.path.join(project_path, fp)
            if os.path.isfile(full):
                content = self._read_file(full)
                file_contents.append(f"=== {fp} ===\n{content}")
        files_text = "\n\n".join(file_contents)[:8000] if file_contents else "(no readable files found)"

        prompt = OVERVIEW_PROMPT + f"\n\n项目: {project_path}\n节点: {node_id}\n\n{files_text}"

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
            )
            raw = response.choices[0].message.content or "{}"
            data = json.loads(self._clean(raw))
            return {
                "description": data.get("description", ""),
                "overview": data.get("overview", ""),
                "files": data.get("files", []),
                "functions": data.get("functions", []),
            }
        except Exception as e:
            logger.error(f"[FeatureAnalyzer] Overview generation failed: {e}")
            return {"description": "", "overview": "", "files": [], "functions": []}

    async def drill_down(self, project_path: str, node_id: str, parent_context: str, language: str = "en") -> List[FeatureNode]:
        """Drill down into a feature/flow node and generate children."""
        try:
            return await self._drill_down_impl(project_path, node_id, parent_context, language)
        except Exception as e:
            logger.error(f"[FeatureAnalyzer] drill_down failed: {e}", exc_info=True)
            return []

    async def _drill_down_impl(self, project_path: str, node_id: str, parent_context: str, language: str = "en") -> List[FeatureNode]:
        parent = find_feature(project_path, node_id)
        if not parent:
            logger.warning(f"[FeatureAnalyzer] Node {node_id} not in DB, building from context")
            parent = {
                "id": node_id, "label": node_id, "level": 1,
                "description": parent_context or "",
                "flow_description": parent_context or "",
                "files": [], "functions": [],
            }
            target_level = 2
        else:
            target_level = parent["level"] + 1

        # Read related files
        file_contents = []
        for fp in parent.get("files", []):
            full_path = os.path.join(project_path, fp)
            if os.path.isfile(full_path):
                content = self._read_file(full_path)
                file_contents.append(f"=== {fp} ===\n{content}")
        files_text = "\n\n".join(file_contents) if file_contents else "(无法读取相关文件)"

        # Choose prompt based on level
        if target_level == 2:
            prompt = (LEVEL2_PROMPT
                .replace("{parent_context}", f"功能: {parent.get('label','')}\n描述: {parent.get('description','')}\n流程概述: {parent.get('flow_description','')}\n相关文件: {', '.join(parent.get('files',[]))}\n核心函数: {', '.join(parent.get('functions',[]))}{parent_context}")
                .replace("{file_contents}", files_text[:8000]))
        elif target_level == 3:
            prompt = (LEVEL3_PROMPT
                .replace("{parent_context}", f"步骤: {parent.get('label','')}\n描述: {parent.get('description','')}\n流程概述: {parent.get('flow_description','')}{parent_context}")
                .replace("{file_contents}", files_text[:8000]))
        else:
            prompt = (LEVEL3_PROMPT
                .replace("{parent_context}", f"节点: {parent.get('label','')}\n{parent_context}")
                .replace("{file_contents}", files_text[:8000]))

        response = await self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": f"请使用{'中文' if language == 'zh' else 'English'}输出 label、description 和 flow_description。\n" + prompt.split('【输出格式】')[0]},
                {"role": "user", "content": f"【输出语言】{'中文' if language == 'zh' else 'English'}\n\n{prompt}"},
            ],
            temperature=0.2,
        )

        raw = response.choices[0].message.content or "{}"
        data = json.loads(self._clean(raw))

        items = data.get("steps") or data.get("details") or []
        nodes = []
        for item in items:
            child_id = f"{node_id}.{item['id']}"
            normalized_files = [self._make_relative(fp, project_path) for fp in item.get("files", [])]
            nodes.append(FeatureNode(
                id=child_id,
                label=item["label"],
                level=target_level,
                parent_id=node_id,
                description=item.get("description", ""),
                flow_description=item.get("flow_description", ""),
                files=normalized_files,
                functions=item.get("functions", []),
            ))

        # Replace children in DB (not merge)
        update_feature_children(project_path, node_id, [n.model_dump() for n in nodes])

        logger.info(f"[FeatureAnalyzer] Generated {len(nodes)} children for {node_id}")
        return nodes

    async def incremental_update(self, project_path: str, change_summary: str, files_changed: list[str]) -> dict:
        """Incrementally update feature graph based on specific code changes."""
        # Load current features
        features = load_features(project_path)
        features_json = json.dumps(features, ensure_ascii=False, indent=2)[:3000]

        # Read changed files
        file_contents = []
        for fp in files_changed:
            full = fp if os.path.isabs(fp) else os.path.join(project_path, fp)
            if os.path.isfile(full):
                content = self._read_file(full)
                file_contents.append(f"=== {fp} ===\n{content}")
        files_text = "\n\n".join(file_contents)[:6000] if file_contents else "(no files read)"

        prompt = INCREMENTAL_PROMPT.format(
            current_features=features_json,
            change_summary=change_summary,
            file_contents=files_text,
        )

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": prompt},
                ],
                temperature=0.1,
            )

            raw = response.choices[0].message.content or "{}"
            data = json.loads(self._clean(raw))
            updates = data.get("updates", [])
            message = data.get("message", "")

            # Apply updates
            for update in updates:
                action = update.get("action")
                if action == "add_feature":
                    feat = update.get("feature", {})
                    if feat.get("id"):
                        feat["project_path"] = project_path
                        feat["level"] = 1
                        feat["files"] = [self._make_relative(f, project_path) for f in feat.get("files", [])]
                        save_features(project_path, features + [feat])
                        logger.info(f"[Incremental] Added feature: {feat['id']}")
                elif action == "update_feature":
                    feat = update.get("feature", {})
                    fid = feat.get("id")
                    if fid:
                        existing = find_feature(project_path, fid)
                        if existing:
                            existing.update({k: v for k, v in feat.items() if v})
                            if "files" in feat:
                                existing["files"] = [self._make_relative(f, project_path) for f in feat["files"]]
                            save_features(project_path, [f for f in features if f["id"] != fid] + [existing])
                            logger.info(f"[Incremental] Updated feature: {fid}")
                elif action == "remove_feature":
                    fid = update.get("feature_id")
                    if fid:
                        features = [f for f in features if f["id"] != fid]
                        save_features(project_path, features)
                        logger.info(f"[Incremental] Removed feature: {fid}")

            logger.info(f"[Incremental] Applied {len(updates)} updates: {message}")
            return {"message": message, "updates": updates}

        except Exception as e:
            logger.error(f"[Incremental] Error: {e}")
            return {"message": str(e), "updates": []}


feature_analyzer = FeatureAnalyzer()
