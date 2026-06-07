import OpenAI from 'openai';
import * as path from 'path';
import * as fs from 'fs';

const MAX_CONTEXT_CHARS = 8000;

/* ── System Prompts ── */

const AGENT_SYSTEM_PROMPT = `你是 CodeAtlas 的 AI 编程助手，你的首要目标是准确理解用户需求再行动。

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
你想给这个接口加什么功能？是加参数校验、还是加缓存、还是改返回格式？`;

const PLANNER_SYSTEM_PROMPT = `你是技术架构师，负责理解需求并制定执行计划。

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
\`\`\`json
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
\`\`\`

先探索，再输出 JSON 计划。`;

const WORKER_SYSTEM_PROMPT = `你是代码执行者。收到任务后直接输出操作标签，不要犹豫，不要解释。

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
- 不要输出"我来读取..."之类的废话，直接 <read-file>`;

/* ── Tag-to-operation mapping ── */

const TAG_TO_OPERATION: Record<string, string> = {
  'list-dir': 'list_dir',
  'read-file': 'read_file',
  'run-shell': 'run_shell',
  'update': 'update',
  'insert-lines': 'insert_lines',
  'replace-lines': 'replace_lines',
  'delete-lines': 'delete_lines',
  'create-file': 'create_file',
  'delete-file': 'delete_file',
  'search': 'search',
};

const OPERATION_TAGS = Object.keys(TAG_TO_OPERATION).join('|');

/* ── Agent Service ── */

export class AgentService {
  private _client: OpenAI | null = null;
  private _model: string | null = null;

  /** Reset cached client so next request picks up new env vars */
  reload(): void {
    this._client = null;
    this._model = null;
  }

  private get client(): OpenAI {
    if (!this._client) {
      this._client = new OpenAI({
        apiKey: process.env.CODEATLAS_LLM_API_KEY,
        baseURL: process.env.CODEATLAS_LLM_BASE_URL,
      });
    }
    return this._client;
  }

  private get model(): string {
    if (!this._model) {
      this._model = process.env.CODEATLAS_LLM_MODEL || '';
    }
    return this._model;
  }

  /* ── Helpers ── */

  private cleanOutput(raw: string): string {
    let text = raw.trim();
    text = text.replace(/^```(?:json)?\s*/i, '');
    text = text.replace(/\s*```$/i, '');
    return text.trim();
  }

  private parseAttrs(rawAttrs: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const re = /([:\w-]+)\s*=\s*"([^"]*)"|'([^']*)'/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(rawAttrs)) !== null) {
      const key = match[1];
      const value = match[2] || match[3] || '';
      attrs[key] = value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"');
    }
    return attrs;
  }

  private intAttr(attrs: Record<string, string>, name: string): number | null {
    const value = attrs[name];
    if (!value) return null;
    const n = parseInt(value, 10);
    return isNaN(n) ? null : n;
  }

  private tagText(text: string): string {
    let t = text.trim();
    if (t.startsWith('<![CDATA[') && t.endsWith(']]>')) {
      t = t.slice(9, -3);
    }
    return t.trim();
  }

  private operationFromTag(tag: string, attrs: Record<string, string>, content: string): Record<string, unknown> {
    let opType = TAG_TO_OPERATION[tag] || tag;
    if (opType === 'update') {
      const status = (attrs.status || attrs.type || attrs.mode || '').toLowerCase();
      opType = { insert: 'insert_lines', replace: 'replace_lines', delete: 'delete_lines' }[status] || 'replace_lines';
    }

    const op: Record<string, unknown> = { type: opType };
    const filePath = attrs.path || attrs.file;
    if (filePath) op.file = filePath;

    const startLine = this.intAttr(attrs, 'start-line') || this.intAttr(attrs, 'start_line');
    const endLine = this.intAttr(attrs, 'end-line') || this.intAttr(attrs, 'end_line');
    const afterLine = this.intAttr(attrs, 'after-line') || this.intAttr(attrs, 'after_line');

    if (startLine !== null) op.start_line = startLine;
    if (endLine !== null) op.end_line = endLine;
    if (afterLine !== null) op.after_line = afterLine;

    const body = this.tagText(content);
    if (body && ['insert_lines', 'replace_lines', 'create_file', 'run_shell', 'search'].includes(opType)) {
      op.content = body;
    }
    return op;
  }

  private parseXmlLike(raw: string): { message: string; operations: Record<string, unknown>[] } {
    const text = this.cleanOutput(raw);
    const ops: Record<string, unknown>[] = [];
    const spans: Array<[number, number]> = [];

    // Block tags: <tag attrs>body</tag>
    const blockRe = new RegExp(
      `<(?<tag>${OPERATION_TAGS})\\b(?<attrs>[^>]*)>(?<body>.*?)</\\k<tag>>`,
      'gis',
    );
    let match: RegExpExecArray | null;
    while ((match = blockRe.exec(text)) !== null) {
      const tag = match.groups!.tag.toLowerCase();
      const attrs = this.parseAttrs(match.groups!.attrs);
      ops.push(this.operationFromTag(tag, attrs, match.groups!.body));
      spans.push([match.index, match.index + match[0].length]);
    }

    // Self-closing tags: <tag attrs />
    const selfClosingRe = new RegExp(
      `<(?<tag>${OPERATION_TAGS})\\b(?<attrs>[^>]*)/>`,
      'gi',
    );
    while ((match = selfClosingRe.exec(text)) !== null) {
      const tag = match.groups!.tag.toLowerCase();
      const attrs = this.parseAttrs(match.groups!.attrs);
      ops.push(this.operationFromTag(tag, attrs, ''));
      spans.push([match.index, match.index + match[0].length]);
    }

    if (ops.length === 0) {
      throw new Error('No XML-like operation tags found');
    }

    // Extract message text between tags
    const messageParts: string[] = [];
    let cursor = 0;
    const sorted = spans.sort((a, b) => a[0] - b[0]);
    for (const [start, end] of sorted) {
      messageParts.push(text.slice(cursor, start));
      cursor = end;
    }
    messageParts.push(text.slice(cursor));
    let message = messageParts.join('').replace(/\n{3,}/g, '\n\n').trim();
    if (!message) {
      const types = ops.map((o) => o.type);
      message = `准备了 ${ops.length} 个操作: ${types.join(', ')}`;
    }
    return { message, operations: ops };
  }

  private parseAgentOutput(raw: string): { message: string; operations: Record<string, unknown>[] } {
    try {
      return this.parseXmlLike(raw);
    } catch {
      // Fallback: try JSON
      try {
        const cleaned = this.cleanOutput(raw);
        const data = JSON.parse(cleaned);
        return {
          message: data.message || '',
          operations: data.operations || [],
        };
      } catch {
        return { message: raw.trim(), operations: [] };
      }
    }
  }

  private buildMessages(systemPrompt: string, userMsg: string, history?: Array<{ role: string; content: string }> | null) {
    const msgs: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];
    if (history) {
      for (const h of history) {
        const role = h.role === 'agent' ? 'assistant' as const : 'user' as const;
        msgs.push({ role, content: h.content });
      }
    }
    msgs.push({ role: 'user', content: userMsg });
    return msgs;
  }

  private truncate(text: string, maxChars = MAX_CONTEXT_CHARS): string {
    if (text.length <= maxChars) return text;
    const half = Math.floor(maxChars / 2);
    return text.slice(0, half) + '\n\n... (truncated) ...\n\n' + text.slice(-half);
  }

  /* ── Intent Classification ── */

  private INTENT_CLASSIFY_PROMPT = `分析用户意图，只回答一个词: execute 或 readonly。

- execute: 用户要求执行操作。包括：修改代码("修bug"、"加功能"、"重构"、"改一下")、运行命令("运行"、"构建"、"安装依赖"、"启动"、"部署"、"测试")、操作文件("创建"、"删除文件")
- readonly: 纯信息咨询。如"怎么实现的"、"为什么这样写"、"有什么建议"、"评估一下"、"这是什么"、"解释一下"

注意: "帮我看看这个bug，然后修一下" → execute
      "帮我运行一下项目" → execute
      "这个方案好不好" → readonly
      "项目入口在哪里" → readonly

只回答一个词。`;

  async classifyIntent(instruction: string): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: this.INTENT_CLASSIFY_PROMPT },
          { role: 'user', content: instruction.slice(0, 500) },
        ],
        temperature: 0,
        max_tokens: 200,
      });
      const result = (response.choices[0].message.content || 'readonly').trim().toLowerCase();
      return result.includes('execute') ? 'execute' : 'readonly';
    } catch {
      return 'readonly';
    }
  }

  /* ── Build user message from request ── */

  buildUserMessage(req: {
    instruction: string;
    open_file?: { path: string; content: string; lines: number } | null;
    file_tree?: unknown[] | null;
    selection?: { file: string; text: string; lines: string } | null;
  }): string {
    const parts: string[] = [`【用户指令】\n${req.instruction}`];

    if (req.open_file) {
      parts.push(
        `\n【当前打开的文件: ${req.open_file.path}，共 ${req.open_file.lines} 行】\n` +
        '```\n' + this.truncate(req.open_file.content) + '\n```',
      );
    }

    if (req.selection) {
      parts.push(
        `\n【用户选中的代码: ${req.selection.file} ${req.selection.lines}】\n` +
        '用户特意选中了这段代码，请围绕这段代码进行修改：\n' +
        '```\n' + req.selection.text + '\n```',
      );
    }

    if (req.file_tree) {
      const treeSummary = JSON.stringify(req.file_tree, null, 2);
      parts.push(`\n【项目文件树 (${req.file_tree.length} 个顶层条目)】\n${this.truncate(treeSummary, 2000)}`);
    } else {
      parts.push('\n【注意: 用户已经打开了一个文件夹，但文件树未加载。请告诉用户稍等，不要说你没看到项目。】');
    }

    return parts.join('\n');
  }

  /* ── Non-streaming chat ── */

  async process(req: {
    instruction: string;
    open_file?: { path: string; content: string; lines: number } | null;
    file_tree?: unknown[] | null;
    selection?: { file: string; text: string; lines: string } | null;
    history?: Array<{ role: string; content: string }> | null;
  }): Promise<{ message: string; operations: Record<string, unknown>[] }> {
    const userMessage = this.buildUserMessage(req);
    const messages = this.buildMessages(AGENT_SYSTEM_PROMPT, userMessage, req.history);

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: 0.0,
      });

      const raw = response.choices[0].message.content || '{}';
      return this.parseAgentOutput(raw);
    } catch (e: any) {
      return { message: `⚠️ 处理出错: ${e.message?.slice(0, 200)}`, operations: [] };
    }
  }

  /* ── Streaming chat (SSE) ── */

  async *processStream(req: {
    instruction: string;
    open_file?: { path: string; content: string; lines: number } | null;
    file_tree?: unknown[] | null;
    selection?: { file: string; text: string; lines: string } | null;
    history?: Array<{ role: string; content: string }> | null;
  }): AsyncGenerator<{ event: string; data: string }> {
    const userMessage = this.buildUserMessage(req);
    const messages = this.buildMessages(AGENT_SYSTEM_PROMPT, userMessage, req.history);

    let fullText = '';
    try {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages,
        temperature: 0.0,
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = (chunk.choices[0]?.delta as any) || {};
        if (delta.reasoning_content) {
          yield { event: 'reasoning', data: delta.reasoning_content };
        }
        const token = delta.content || '';
        if (token) {
          fullText += token;
          yield { event: 'token', data: token };
        }
      }

      const { message, operations } = this.parseAgentOutput(fullText);
      yield {
        event: 'done',
        data: JSON.stringify({ message, operations }),
      };
    } catch (e: any) {
      yield {
        event: 'done',
        data: JSON.stringify({ message: `⚠️ 处理出错: ${e.message?.slice(0, 200)}`, operations: [] }),
      };
    }
  }

  /* ── Planner ── */

  async *planStream(instruction: string): AsyncGenerator<{ event: string; data: string }> {
    const userMsg = `【用户需求】\n${instruction}\n\n【项目路径】\n${process.env.CODEATLAS_PROJECT_PATH || ''}\n\n请先探索项目结构，然后输出 JSON 计划。`;
    let fullText = '';

    try {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: PLANNER_SYSTEM_PROMPT },
          { role: 'user', content: userMsg },
        ],
        temperature: 0.0,
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = (chunk.choices[0]?.delta as any) || {};
        const token = delta.content || delta.reasoning_content || '';
        if (token) {
          fullText += token;
          yield { event: 'plan_token', data: token };
        }
      }

      const plan = this.extractPlanJson(fullText);
      yield { event: 'plan', data: JSON.stringify(plan) };
    } catch (e: any) {
      yield { event: 'plan_error', data: JSON.stringify({ error: e.message }) };
    }
  }

  private extractPlanJson(text: string): Record<string, unknown> {
    let match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (match) {
      text = match[1];
    } else {
      match = text.match(/\{[\s\S]*"steps"[\s\S]*\}/);
      if (match) text = match[0];
    }
    try {
      return JSON.parse(text);
    } catch {
      return { plan: '无法解析计划', steps: [], raw: text.slice(0, 500) };
    }
  }

  /* ── Sub-agent (Worker) ── */

  async *runSubAgent(task: string, stepId: number): AsyncGenerator<{ event: string; data: string; step_id?: number }> {
    let fullText = '';
    try {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: WORKER_SYSTEM_PROMPT },
          { role: 'user', content: `【任务 ${stepId}】\n${task}` },
        ],
        temperature: 0.0,
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = (chunk.choices[0]?.delta as any) || {};
        const token = delta.content || delta.reasoning_content || '';
        if (token) {
          fullText += token;
          yield { event: 'step_token', data: token, step_id: stepId };
        }
      }

      const { message, operations } = this.parseAgentOutput(fullText);
      yield {
        event: 'step_done',
        data: JSON.stringify({ step_id: stepId, message, operations }),
      };
    } catch (e: any) {
      yield {
        event: 'step_error',
        data: JSON.stringify({ step_id: stepId, error: e.message }),
      };
    }
  }
}

export const agentService = new AgentService();
