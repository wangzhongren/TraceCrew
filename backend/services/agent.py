import json
import logging
import os
import re
from html import unescape

from openai import AsyncOpenAI

from models.event import AgentRequest, AgentResponse, FileOperation
from services.analyzer import topology_analyzer
from services.sse_manager import sse_manager

logger = logging.getLogger("codeatlas.agent")

MAX_CONTEXT_CHARS = 8000  # Truncate huge files to avoid blowing context window

AGENT_SYSTEM_PROMPT = """你是 CodeAtlas 的 AI 编程助手，你的首要目标是准确理解用户需求再行动。

【核心原则 —— 理解优先，谨慎执行】
1. 先理解用户的需求是什么，不清楚的地方可以简短追问，不要猜测后擅自行动
2. 需求不明确时，先问用户想要什么效果，而不是自己假设一个方案就动手
3. 需要修改代码时，先简要说明你打算改什么、为什么这样改，然后再输出操作
4. 能不改的地方尽量不改，只改用户真正关心的部分
5. 小改动只改相关行，不要重写整个文件
6. 用户只是跟你聊天、问问题、讨论方案时，不要擅自修改代码

【工作模式】
你默认处于「只读模式」—— 只能用 read_file 读文件 + 文字回复，禁止输出 update/create_file/run-shell。
只有用户消息中包含 「【执行模式】」 标记时，你才进入「执行模式」，可以输出修改操作。
在只读模式下即使用户说"改一下"，你也只能给出方案，不能直接动手。

【操作类型】
- list_dir: 浏览目录。path 填相对路径，空或 '.' 表示根目录
- search: 搜索代码。标签体内写搜索关键词，path 指定搜索目录（可选）
- read_file: 读取文件。file 填相对路径，可选 start_line/end_line
- run_shell: 在终端执行命令。标签体内写完整的 shell 命令
- update: 修改文件。用 status="insert|replace|delete"
- create_file: 创建新文件
- delete_file: 删除整个文件

【输出格式】XML-like 标签，不要 JSON。
注意：操作标签只允许在用户明确要求动手后才能输出。

浏览目录：
<list-dir path="backend/"></list-dir>
<list-dir path="."></list-dir>

搜索代码：
<search path="backend/">handleSubmit</search>
<search>def login</search>

读取文件：
<read-file path="backend/services/agent.py"></read-file>
<read-file path="backend/services/agent.py" start-line="10" end-line="80"></read-file>

新增文件：
<create-file path="src/new.ts">
完整文件内容
</create-file>

删除文件：
<delete-file path="src/deprecated.ts"></delete-file>

修改文件（插入）：
<update status="insert" path="src/app.ts" after-line="42">
要插入的内容
</update>

修改文件（替换）：
<update status="replace" path="src/app.ts" start-line="10" end-line="20">
替换后的完整内容
</update>

修改文件（删除）：
<update status="delete" path="src/app.ts" start-line="10" end-line="20"></update>

执行命令：
<run-shell>python main.py</run-shell>
<run-shell>cd backend && source .venv/bin/activate && python main.py</run-shell>


【规则】
- path 使用相对项目路径
- 需要了解项目结构时，用 list-dir 自己探索，不要依赖记忆或猜测
- 文件内容 > 用户口述 > 你的推测
- 没读过的文件不要断言其内容
- 严禁编造文件名、函数名、行号

示例——需要先读文件：
我先看一下 agent.py 的当前结构，了解现有的方法有哪些。
<read-file path="backend/services/agent.py"></read-file>

示例——读完后说明+修改：
我看到 agent.py 第 40-50 行是路由注册。在它后面加上新的 /api/health 端点就行。
<update status="insert" path="backend/services/agent.py" after-line="50">
@app.get("/api/health")
def health():
    return {"status": "ok"}
</update>

示例——不需要修改：
这个功能已经正确实现了，代码不需要修改。

示例——需求不明确时追问：
你想给这个接口加什么功能？是加参数校验、还是加缓存、还是改返回格式？"""


PLANNER_SYSTEM_PROMPT = """你是技术架构师，负责理解需求并制定执行计划。

【你的职责】
1. 理解用户需求，用 read_file 和 list_dir 探索项目结构
2. 输出一个结构化的 JSON 执行计划

【规则】
- 你只能读取文件，不能修改任何代码
- 计划要具体，每个步骤明确要改什么文件、改什么内容
- 步骤数量 3-8 个，不要太细也不要太粗
- 如果步骤之间有依赖，用 deps 标注
- 探索项目至少读 2-3 个关键文件再出计划

【输出格式】严格 JSON，不要其他内容：
```json
{
  "plan": "一句话概述计划",
  "steps": [
    {
      "id": 1,
      "title": "步骤标题",
      "description": "具体要做什么",
      "deps": []
    },
    {
      "id": 2,
      "title": "另一个步骤",
      "description": "具体要做什么",
      "deps": [1]
    }
  ]
}
```

先探索，再输出 JSON 计划。"""


WORKER_SYSTEM_PROMPT = """你是代码执行者。收到任务后直接输出操作标签，不要犹豫，不要解释。

【操作标签】
<read-file path="path/to/file"></read-file>
<list-dir path="."></list-dir>
<update status="insert|replace|delete" path="file" start-line="N" end-line="M">内容</update>
<create-file path="path/to/file">文件内容</create-file>
<delete-file path="path/to/file"></delete-file>
<run-shell>命令</run-shell>

完成后输出 <done>完成摘要</done>

【规则】
- 直接动手，先输出操作标签，最后再总结
- path 使用相对路径
- 不要输出"我来读取..."之类的废话，直接 <read-file>"""

TAG_TO_OPERATION = {
    "list-dir": "list_dir",
    "read-file": "read_file",
    "run-shell": "run_shell",
    "update": "update",
    "insert-lines": "insert_lines",
    "replace-lines": "replace_lines",
    "delete-lines": "delete_lines",
    "create-file": "create_file",
    "delete-file": "delete_file",
    "search": "search",
}

OPERATION_TAGS = "|".join(TAG_TO_OPERATION)


class AgentService:
    def __init__(self):
        self.client = AsyncOpenAI(
            api_key=os.getenv("CODEATLAS_LLM_API_KEY"),
            base_url=os.getenv("CODEATLAS_LLM_BASE_URL"),
        )
        self.model = os.getenv("CODEATLAS_LLM_MODEL")

    INTENT_CLASSIFY_PROMPT = """分析用户意图，只回答一个词: execute 或 readonly。

- execute: 用户要求执行操作。包括：修改代码("修bug"、"加功能"、"重构"、"改一下")、运行命令("运行"、"构建"、"安装依赖"、"启动"、"部署"、"测试")、操作文件("创建"、"删除文件")
- readonly: 纯信息咨询。如"怎么实现的"、"为什么这样写"、"有什么建议"、"评估一下"、"这是什么"、"解释一下"

注意: "帮我看看这个bug，然后修一下" → execute
      "帮我运行一下项目" → execute
      "这个方案好不好" → readonly
      "项目入口在哪里" → readonly

只回答一个词。"""

    async def classify_intent(self, instruction: str) -> str:
        """Classify user intent: execute or readonly. Fast lightweight call."""
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": self.INTENT_CLASSIFY_PROMPT},
                    {"role": "user", "content": instruction[:500]},
                ],
                temperature=0,
                max_tokens=200,  # reasoning model needs room for thinking + answer
            )
            result = (response.choices[0].message.content or response.choices[0].message.reasoning_content or "readonly").strip().lower()
            return "execute" if "execute" in result else "readonly"
        except Exception:
            return "readonly"  # safe default

    def _clean_output(self, raw: str) -> str:
        raw = raw.strip()
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
        return raw.strip()

    def _parse_attrs(self, raw_attrs: str) -> dict:
        attrs = {}
        for key, _quoted, double_value, single_value in re.findall(r'([:\w-]+)\s*=\s*("([^"]*)"|\'([^\']*)\')', raw_attrs):
            attrs[key] = unescape(double_value or single_value or "")
        return attrs

    def _int_attr(self, attrs: dict, name: str):
        value = attrs.get(name)
        if value is None or value == "":
            return None
        try:
            return int(value)
        except ValueError:
            return None

    def _tag_text(self, text: str) -> str:
        text = text.strip()
        if text.startswith("<![CDATA[") and text.endswith("]]>"):
            text = text[9:-3]
        return text.strip("\n")

    def _operation_from_tag(self, tag: str, attrs: dict, content: str) -> dict:
        op_type = TAG_TO_OPERATION[tag]
        if op_type == "update":
            status = (attrs.get("status") or attrs.get("type") or attrs.get("mode") or "").lower()
            op_type = {
                "insert": "insert_lines",
                "replace": "replace_lines",
                "delete": "delete_lines",
            }.get(status, "replace_lines")
        op = {"type": op_type}
        path = attrs.get("path") or attrs.get("file")
        if path:
            op["file"] = path
        start_line = self._int_attr(attrs, "start-line") or self._int_attr(attrs, "start_line")
        end_line = self._int_attr(attrs, "end-line") or self._int_attr(attrs, "end_line")
        after_line = self._int_attr(attrs, "after-line") or self._int_attr(attrs, "after_line")
        if start_line is not None:
            op["start_line"] = start_line
        if end_line is not None:
            op["end_line"] = end_line
        if after_line is not None:
            op["after_line"] = after_line
        body = self._tag_text(content)
        if body and op_type in {"insert_lines", "replace_lines", "create_file", "run_shell", "search"}:
            op["content"] = body
        return op

    def _parse_xml_like(self, raw: str) -> tuple[str, list[dict]]:
        text = self._clean_output(raw)
        ops: list[dict] = []
        spans: list[tuple[int, int]] = []

        block_re = re.compile(
            rf"<(?P<tag>{OPERATION_TAGS})\b(?P<attrs>[^>]*)>(?P<body>.*?)</(?P=tag)>",
            re.DOTALL | re.IGNORECASE,
        )
        for match in block_re.finditer(text):
            tag = match.group("tag").lower()
            attrs = self._parse_attrs(match.group("attrs"))
            ops.append(self._operation_from_tag(tag, attrs, match.group("body")))
            spans.append(match.span())

        self_closing_re = re.compile(
            rf"<(?P<tag>{OPERATION_TAGS})\b(?P<attrs>[^>]*)/>",
            re.DOTALL | re.IGNORECASE,
        )
        for match in self_closing_re.finditer(text):
            tag = match.group("tag").lower()
            attrs = self._parse_attrs(match.group("attrs"))
            ops.append(self._operation_from_tag(tag, attrs, ""))
            spans.append(match.span())

        if not ops:
            raise ValueError("No XML-like operation tags found")

        message_parts = []
        cursor = 0
        for start, end in sorted(spans):
            message_parts.append(text[cursor:start])
            cursor = end
        message_parts.append(text[cursor:])
        message = re.sub(r"\n{3,}", "\n\n", "".join(message_parts)).strip()
        if not message:
            types = [op.get("type", "?") for op in ops]
            message = f"准备了 {len(ops)} 个操作: {', '.join(types)}"
        return message, ops

    def _parse_agent_output(self, raw: str) -> tuple[str, list[FileOperation]]:
        cleaned = self._clean_output(raw)
        try:
            message, ops_data = self._parse_xml_like(cleaned)
        except ValueError:
            try:
                data = json.loads(cleaned)
                message = data.get("message", "")
                ops_data = data.get("operations", [])
            except json.JSONDecodeError:
                message = cleaned.strip()
                ops_data = []

        if not message and not ops_data:
            message = "没有检测到需要修改的内容，请重新描述你的需求"
        elif not message:
            types = [op.get("type", "?") for op in ops_data]
            message = f"准备了 {len(ops_data)} 个操作: {', '.join(types)}"

        operations = [FileOperation(**op) for op in ops_data]
        return message, operations

    def _build_messages(self, system_prompt: str, user_msg: str, history: list | None) -> list:
        msgs = [{"role": "system", "content": system_prompt}]
        if history:
            for h in history:
                role = "assistant" if h.get("role") == "agent" else "user"
                msgs.append({"role": role, "content": h.get("content", "")})
        msgs.append({"role": "user", "content": user_msg})
        logger.info(f"[Agent] Messages: {len(msgs)} total ({len(history or [])} history)")
        return msgs

    def _truncate(self, text: str, max_chars: int = MAX_CONTEXT_CHARS) -> str:
        if len(text) <= max_chars:
            return text
        half = max_chars // 2
        return text[:half] + "\n\n... (truncated) ...\n\n" + text[-half:]

    async def process(self, req: AgentRequest) -> AgentResponse:
        parts = [f"【用户指令】\n{req.instruction}"]

        if req.open_file:
            parts.append(
                f"\n【当前打开的文件: {req.open_file.path}，共 {req.open_file.lines} 行】\n"
                f"```\n{self._truncate(req.open_file.content)}\n```"
            )

        if req.selection:
            parts.append(
                f"\n【用户选中的代码: {req.selection.file} {req.selection.lines}】\n"
                f"用户特意选中了这段代码，请围绕这段代码进行修改：\n"
                f"```\n{req.selection.text}\n```"
            )

        if req.file_tree:
            tree_summary = json.dumps(req.file_tree, ensure_ascii=False, indent=2)
            parts.append(f"\n【项目文件树 ({len(req.file_tree)} 个顶层条目)】\n{self._truncate(tree_summary, 2000)}")
        else:
            parts.append("\n【注意: 用户已经打开了一个文件夹，但文件树未加载。请告诉用户稍等，不要说你没看到项目。】")

        user_message = "\n".join(parts)
        logger.info(f"[Agent] Context size: {len(user_message)} chars")

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=self._build_messages(AGENT_SYSTEM_PROMPT, user_message, req.history),
                temperature=0.0,
            )

            raw = response.choices[0].message.content or "{}"
            logger.info(f"[Agent] Raw LLM response ({len(raw)} chars): {raw[:300]}")

            message, operations = self._parse_agent_output(raw)
            logger.info(f"[Agent] Parsed: message='{message}', {len(operations)} ops")
            return AgentResponse(message=message, operations=operations)

        except (json.JSONDecodeError, ValueError) as e:
            logger.error(f"[Agent] output parse error: {e}\nContent: {raw[:500]}")
            return AgentResponse(
                message=f"LLM 返回格式异常，请重试。（技术细节: {str(e)[:100]}）",
                operations=[],
            )
        except Exception as e:
            logger.error(f"[Agent] Error: {e}")
            return AgentResponse(
                message=f"⚠️ 处理出错: {str(e)[:200]}",
                operations=[],
            )

    async def process_stream(self, req: AgentRequest):
        """Stream LLM output token by token, yield events. Final event contains parsed JSON."""
        parts = [f"【用户指令】\n{req.instruction}"]
        if req.open_file:
            parts.append(
                f"\n【当前打开的文件: {req.open_file.path}，共 {req.open_file.lines} 行】\n"
                f"```\n{self._truncate(req.open_file.content)}\n```"
            )
        if req.selection:
            parts.append(
                f"\n【用户选中的代码: {req.selection.file} {req.selection.lines}】\n"
                f"```\n{req.selection.text}\n```"
            )
        user_message = "\n".join(parts)
        logger.info(f"[Agent] Stream: instruction='{req.instruction[:50]}' | "
                    f"open_file={'yes' if req.open_file else 'no'} | "
                    f"file_tree={len(req.file_tree or [])} entries | "
                    f"selection={'yes' if req.selection else 'no'} | "
                    f"total={len(user_message)} chars")

        full_text = ""
        try:
            stream = await self.client.chat.completions.create(
                model=self.model,
                messages=self._build_messages(AGENT_SYSTEM_PROMPT, user_message, req.history),
                temperature=0.0,
                stream=True,
            )

            async for chunk in stream:
                delta = chunk.choices[0].delta
                # Emit reasoning as separate events — frontend can collapse them
                if delta.reasoning_content:
                    yield {"event": "reasoning", "data": delta.reasoning_content}
                if delta.content:
                    full_text += delta.content
                    yield {"event": "token", "data": delta.content}

            message, operations = self._parse_agent_output(full_text)

            yield {
                "event": "done",
                "data": json.dumps({
                    "message": message,
                    "operations": [op.model_dump() for op in operations],
                }, ensure_ascii=False),
            }

        except (json.JSONDecodeError, ValueError) as e:
            logger.error(f"[Agent] Stream parse error: {e}\nContent: {full_text[:500]}")
            yield {"event": "done", "data": json.dumps({
                "message": f"LLM 返回格式异常，请重试",
                "operations": [],
            }, ensure_ascii=False)}
        except Exception as e:
            logger.error(f"[Agent] Stream error: {e}")
            yield {"event": "done", "data": json.dumps({
                "message": f"⚠️ 处理出错: {str(e)[:200]}",
                "operations": [],
            }, ensure_ascii=False)}

    async def apply_operations(self, operations: list):
        for op in operations:
            op_type = op.get("type") if isinstance(op, dict) else getattr(op, "type", None)
            op_file = op.get("file") if isinstance(op, dict) else getattr(op, "file", None)
            op_content = op.get("content") if isinstance(op, dict) else getattr(op, "content", None)
            if op_type in ('insert_lines', 'replace_lines', 'delete_lines', 'create_file', 'delete_file'):
                if op_file and op_content:
                    diff = f"--- a/{op_file}\n+++ b/{op_file}\n@@ change @@\n"
                    for line in op_content.split('\n'):
                        diff += f"+{line}\n"
                    await topology_analyzer.analyze_diff(op_file, diff)

        await sse_manager.broadcast([{"action": "refresh"}])
        logger.info(f"[Agent] Applied {len(operations)} ops, topology updated")

    # ── Planner + Sub-agent ──────────────────────────

    async def plan_stream(self, instruction: str):
        """Main agent explores project and outputs a structured JSON plan."""
        user_msg = (
            f"【用户需求】\n{instruction}\n\n"
            f"【项目路径】\n{os.getenv('CODEATLAS_PROJECT_PATH', '')}\n\n"
            "请先探索项目结构，然后输出 JSON 计划。"
        )
        full_text = ""
        try:
            stream = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": PLANNER_SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                temperature=0.0,
                stream=True,
            )
            async for chunk in stream:
                delta = chunk.choices[0].delta
                token = delta.content or delta.reasoning_content or ""
                if token:
                    full_text += token
                    yield {"event": "plan_token", "data": token}

            # Extract JSON from response
            plan = self._extract_plan_json(full_text)
            yield {"event": "plan", "data": json.dumps(plan, ensure_ascii=False)}

        except Exception as e:
            logger.error(f"[Planner] Error: {e}")
            yield {"event": "plan_error", "data": json.dumps({"error": str(e)}, ensure_ascii=False)}

    def _extract_plan_json(self, text: str) -> dict:
        """Extract plan JSON from LLM response (may have markdown fences)."""
        match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', text)
        if match:
            text = match.group(1)
        else:
            match = re.search(r'\{[\s\S]*"steps"[\s\S]*\}', text)
            if match:
                text = match.group(0)
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return {"plan": "无法解析计划", "steps": [], "raw": text[:500]}

    async def run_sub_agent(self, task: str, step_id: int):
        """Worker agent executes a single task step. Yields SSE events."""
        full_text = ""
        try:
            stream = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": WORKER_SYSTEM_PROMPT},
                    {"role": "user", "content": f"【任务 {step_id}】\n{task}"},
                ],
                temperature=0.0,
                stream=True,
            )
            async for chunk in stream:
                delta = chunk.choices[0].delta
                token = delta.content or delta.reasoning_content or ""
                if token:
                    full_text += token
                    yield {"event": "step_token", "data": token, "step_id": step_id}

            message, operations = self._parse_agent_output(full_text)
            yield {
                "event": "step_done",
                "data": json.dumps({
                    "step_id": step_id,
                    "message": message,
                    "operations": [op.model_dump() for op in operations],
                }, ensure_ascii=False),
            }
        except Exception as e:
            logger.error(f"[Worker {step_id}] Error: {e}")
            yield {
                "event": "step_error",
                "data": json.dumps({"step_id": step_id, "error": str(e)}, ensure_ascii=False),
            }


agent_service = AgentService()
