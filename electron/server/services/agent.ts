import OpenAI from 'openai';
import * as path from 'path';
import {
  listDirectory, readFile, writeFile,
  insertLines, replaceLines, deleteLines, deleteFile,
  searchInFiles, runShell, killShell,
} from '../../fileManager';
import { existsSync } from 'fs';

const MAX_CONTEXT_CHARS = 24000;

/* ── System Prompts ── */

/* ═══════════════════════════════════════════════════════════
   Protocol definitions — shared by all agents
   ═══════════════════════════════════════════════════════════ */

const PROTOCOL_BASE = `【核心规则】
- 每条回复必须以操作标签开头，先干活再说话
- 正确：<read-file path="src/main.ts"></read-file>\n入口文件是 main.ts...
- 错误：我需要看一下入口文件...（没有标签 = 没有行动）
- 宁愿多读一个文件，也不要只描述不行动
- path 使用相对于项目根目录的相对路径
- 严禁编造文件名、函数名、行号
  - 文件内容 > 用户口述 > 你的推测
  - 不要说"我只读"、"我不能写"之类的话，直接干活
  - 禁止反问用户，你是执行单元不是客服。信息不够就去读文件，读不到就说不知道，永远不要问用户"你想怎么做""请提供更多信息"
  - **每条回复只能有 1 个操作标签**，做完这个操作后下一轮再做下一个`;

const PROTOCOL_READONLY = `${PROTOCOL_BASE}

【可用操作 — 只读】
- list-dir: 列出目录内容。path 填相对路径，空或 "." 表示根目录
- search: 搜索代码。标签体内写关键词，path 指定搜索目录（可选）
- read-file: 读取文件内容。file 填相对路径，可选 start-line/end-line

<list-dir path="."></list-dir>
<list-dir path="src/"></list-dir>
<search path="src/">关键词</search>
<read-file path="src/main.ts"></read-file>
<read-file path="src/main.ts" start-line="10" end-line="80"></read-file>`;

const PROTOCOL_EXECUTE = `${PROTOCOL_BASE}

【可用操作 — 读写】
- list-dir: 列出目录。path 填相对路径
- search: 搜索代码。标签体内写关键词
- read-file: 读取文件。file 填相对路径，可选 start-line/end-line
- update: 修改文件。status="insert"(在 after-line 后插入) | "replace"(替换 start-line 到 end-line) | "delete"(删除 start-line 到 end-line)
- create-file: 创建新文件。标签体内写完整文件内容
- delete-file: 删除文件
- run-shell: 在终端执行命令。标签体内写 shell 命令

<list-dir path="."></list-dir>
<search path="src/">关键词</search>
<read-file path="src/main.ts"></read-file>
<read-file path="src/main.ts" start-line="10" end-line="80"></read-file>
<update status="insert" path="src/app.ts" after-line="42">要插入的内容</update>
<update status="replace" path="src/app.ts" start-line="10" end-line="20">替换后的内容</update>
<update status="delete" path="src/app.ts" start-line="10" end-line="20"></update>
<create-file path="src/new.ts">完整文件内容</create-file>
<delete-file path="src/deprecated.ts"></delete-file>
<run-shell>python main.py</run-shell>
<run-shell>cd backend && source .venv/bin/activate && python main.py</run-shell>`;

/* ═══════════════════════════════════════════════════════════
   Agent system prompts — role + protocol
   ═══════════════════════════════════════════════════════════ */


const PLANNER_SYSTEM_PROMPT = `你是 CodeAtlas 的首席架构师。你有极强的代码理解能力和系统设计能力。

【你的能力】
- 深入分析项目架构，理解模块划分、调用关系、数据流向
- 精准定位问题根因，给出可行的修复方案
- 设计新功能时考虑扩展性、兼容性、最小侵入
- 评估技术方案的风险和工作量，给出推荐路径

【工作方式 — 证据优先，直觉靠边】
- 每个结论必须引用具体文件的代码作为证据（文件路径 + 行号）
- 不读文件就没有发言权。没读过的模块直接说"未探索"，不要猜测
- 调用关系、函数签名、数据结构必须从代码中来，不能凭经验推断
- 如果两个文件有同名函数但逻辑不同，这是重要发现，必须指出

根据任务复杂度自由组织你的分析报告，可以包含：
- 问题诊断：根因分析、影响范围、证据引用
- 架构设计：模块划分、接口定义、数据流图
- 功能规划：分步实现计划、依赖关系、风险评估
- 调用链梳理：关键文件、函数签名、IPC 通道

【输出】
用 Markdown 组织你的分析。格式为你服务，不是约束你。一份好的分析报告应该让读者看完就完全理解问题和方案。

${PROTOCOL_READONLY}`;

const MAPPER_SYSTEM_PROMPT = `你是 CodeAtlas 的调用链路绘制者。你拥有读取项目文件的能力，通过操作标签探索代码。只能读代码，不能修改。

【职责】
1. 先判断是否需要画图：除了问候/闲聊之外都要画图（bug修复/新功能/模块设计/架构改动/代码解释都需要画）
2. 如果需要画图，读取 Planner 提到的关键文件，验证后输出 JSON
3. 如果不需要画图，直接输出 skip 标记

【输出格式】
- 需要画图时，输出 JSON：
\`\`\`json
{"call_graph":{"nodes":[...],"edges":[...]}}
\`\`\`

- 不需要画图时，只需输出：
**skip_map**: true
（然后输出简单的文字分析即可）

${PROTOCOL_READONLY}`;

const EXECUTOR_SYSTEM_PROMPT = `你是代码执行者。按计划逐步修改代码。

【规则】
- 改代码前必须先 read_file 确认当前代码
- 改动尽量小，只改相关行
- 一次改完相关文件后输出 <done>完成摘要</done>

${PROTOCOL_EXECUTE}`;

const REVIEWER_SYSTEM_PROMPT = `你是独立审查者。先读文件验证，再输出 JSON 结论。

【铁律】没有读文件就直接 failed。读文件阶段用操作标签。读完所有文件后，直接输出纯 JSON（不带代码块）：{"passed": true, "feedback": "一句话总结", "issues": [{"severity": "critical|high|medium|low", "file": "...", "claim": "...", "reality": "..."}]}

${PROTOCOL_READONLY}`;

const REVIEWER_EXEC_SYSTEM_PROMPT = `你是独立审查者。先读文件验证，再输出 JSON 结论。

【铁律】没有读文件就直接 failed。读文件阶段用操作标签。读完所有文件后，直接输出纯 JSON（不带代码块）：{"passed": true, "feedback": "一句话总结", "issues": [{"severity": "critical|high|medium|low", "file": "...", "claim": "...", "reality": "..."}]}

${PROTOCOL_READONLY}`;

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

  private buildMessages(history?: Array<{ role: string; content: string }> | null) {
    const msgs: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    if (history) {
      for (const h of history) {
        const role = h.role === 'agent' ? 'assistant' as const : 'user' as const;
        msgs.push({ role, content: h.content });
      }
    }
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

  /* ── Non-streaming chat ── */

  async process(req: {
    history?: Array<{ role: string; content: string }> | null;
  }): Promise<{ message: string; operations: Record<string, unknown>[] }> {
    const messages = this.buildMessages(req.history);

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
    history?: Array<{ role: string; content: string }> | null;
    project_path?: string | null;
    mode?: string | null;
  }): AsyncGenerator<{ event: string; data: string }> {
    const messages = this.buildMessages(req.history);
    const projectPath = req.project_path || '';

    // Select system prompt by agent mode
    const SYSTEM_PROMPTS: Record<string, string> = {
      planner: PLANNER_SYSTEM_PROMPT,
      mapper: MAPPER_SYSTEM_PROMPT,
      executor: EXECUTOR_SYSTEM_PROMPT,
      reviewer: REVIEWER_SYSTEM_PROMPT,
      reviewer_exec: REVIEWER_EXEC_SYSTEM_PROMPT,
    };
    console.log('1222222'+req.mode);
    const mode = req.mode || 'default';

    const systemPrompt = SYSTEM_PROMPTS[mode] || PROTOCOL_EXECUTE;
    console.log(systemPrompt);
    if (systemPrompt && messages[0]?.role !== 'system') {
      messages.unshift({ role: 'system', content: systemPrompt});
    }
   
    console.log("2222222222"+ systemPrompt)
    console.log(messages[0])
    console.log(`[processStream] mode=${mode} msgs=${messages.length}`);

    console.log("2222222222"+ JSON.stringify(messages[0]))
    for (let i = 0; i < Math.min(messages.length, 3); i++) {
      console.log(`[processStream]   msg[${i}] role=${messages[i].role} preview=${messages[i].content.slice(0, 100)}`);
    }

    let turn = 0, emptyCount = 0;
    const startTime = Date.now();
    while (true) {
      if (++turn > 50) {
        console.log(`[processStream] TURN LIMIT reached (${turn - 1} turns, ${Date.now() - startTime}ms)`);
        yield { event: 'done', data: JSON.stringify({ message: '已达到最大轮次限制', operations: [] }) };
        return;
      }
      console.log(`[processStream] ═══ Turn ${turn} (${messages.length} msgs in history) ═══`);
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
      } catch (e: any) {
        console.log(`[processStream] ERROR at turn ${turn}: ${e.message?.slice(0, 200)}`);
        yield {
          event: 'done',
          data: JSON.stringify({ message: `⚠️ 处理出错: ${e.message?.slice(0, 200)}`, operations: [] }),
        };
        return;
      }

      console.log(`[processStream] Turn ${turn} output: ${fullText.length} chars, last 200:`, fullText.slice(-200));

      // Parse operations from the response
      let operations: Record<string, unknown>[] = [];
      let agentMessage = fullText;
      try {
        const parsed = this.parseXmlLike(fullText);
        operations = parsed.operations;
        agentMessage = parsed.message;
        console.log(`[processStream] Turn ${turn} parsed: ${operations.length} ops [${operations.map(o => o.type).join(', ')}], message: ${agentMessage.length} chars`);
      } catch (e: any) {
        console.log(`[processStream] Turn ${turn} NO XML ops found: ${e.message?.slice(0, 100)}`);
      }

      // Save assistant response to conversation
      messages.push({ role: 'assistant', content: fullText });

      if (operations.length === 0) {
        if (fullText.trim().length < 5) {
          emptyCount++;
          if (emptyCount >= 3) {
            yield { event: 'done', data: JSON.stringify({ message: `⚠️ LLM 连续返回空响应`, operations: [] }) };
            return;
          }
          messages.push({ role: 'user', content: '请继续。' });
          continue;
        }
        emptyCount = 0;
        yield { event: 'done', data: JSON.stringify({ message: agentMessage, operations: [] }) };
        return;
      }
      emptyCount = 0;

      console.log(`[processStream] Turn ${turn} executing ${operations.length} tools...`);
      yield {
        event: 'tools',
        data: JSON.stringify({ count: operations.length, ops: operations.map((o) => ({ type: o.type, file: o.file })) }),
      };

      // Execute all tools
      let toolResults = '';
      for (const op of operations) {
        const result = await this.executeTool(op, projectPath);
        toolResults += result + '\n\n';
      }
      console.log(`[processStream] Turn ${turn} tools done: ${toolResults.length} chars result`);

      // Feed results back to LLM for next turn
      messages.push({
        role: 'user',
        content: `【工具执行结果】\n${toolResults.trim()}\n\n请基于以上结果继续处理。`,
      });
    }

  }

  /** Execute a tool operation and return the formatted result. */
  private async executeTool(op: Record<string, unknown>, projectPath: string): Promise<string> {
    const type = op.type as string;
    const filePath = (op.file as string) || '';
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(projectPath, filePath);

    try {
      switch (type) {
        case 'list_dir': {
          const dirPath = filePath ? fullPath : projectPath;
          const entries = listDirectory(dirPath);
          const tree = JSON.stringify(entries, null, 2);
          return `[list_dir ${filePath || '.'}]\n${tree.slice(0, 12000)}`;
        }
        case 'read_file': {
          const startLine = (op.start_line as number) || 1;
          const endLine = op.end_line as number | undefined;
          const result = readFile(fullPath, startLine, endLine);
          // Add line numbers so the LLM can reference specific lines
          const numbered = result.lines
            .map((l: string, i: number) => `${String(startLine + i).padStart(4, ' ')}| ${l}`)
            .join('\n');
          const truncated = this.truncate(numbered, 12000);
          return `[read_file ${filePath} L${startLine}${endLine ? `-L${endLine}` : `-L${startLine + result.lineCount - 1}`} (${result.lineCount} lines)]\n\`\`\`\n${truncated}\n\`\`\``;
        }
        case 'search': {
          const query = (op.content as string) || '';
          const searchPath = filePath ? fullPath : projectPath;
          const results = searchInFiles(query, searchPath);
          const summary = results.map((r) => `${r.file}:${r.line}  ${r.text}`).join('\n');
          return `[search "${query}" in ${filePath || '.'}]\n${summary.slice(0, 12000) || '(无匹配结果)'}`;
        }
        case 'insert_lines': {
          const afterLine = (op.after_line as number) || 0;
          const content = (op.content as string) || '';
          const r = insertLines(fullPath, afterLine, content);
          return `[insert_lines ${filePath} after L${afterLine}]\n${r.success ? '✅ 成功' : '❌ 失败: ' + r.error}`;
        }
        case 'replace_lines': {
          const startLine = (op.start_line as number) || 1;
          const endLine = (op.end_line as number) || 1;
          const content = (op.content as string) || '';
          const r = replaceLines(fullPath, startLine, endLine, content);
          return `[replace_lines ${filePath} L${startLine}-L${endLine}]\n${r.success ? '✅ 成功' : '❌ 失败: ' + r.error}`;
        }
        case 'delete_lines': {
          const startLine = (op.start_line as number) || 1;
          const endLine = (op.end_line as number) || 1;
          const r = deleteLines(fullPath, startLine, endLine);
          return `[delete_lines ${filePath} L${startLine}-L${endLine}]\n${r.success ? '✅ 成功' : '❌ 失败: ' + r.error}`;
        }
        case 'create_file': {
          const content = (op.content as string) || '';
          const r = writeFile(fullPath, content);
          return `[create_file ${filePath}]\n${r.success ? '✅ 成功' : '❌ 失败: ' + r.error}`;
        }
        case 'delete_file': {
          const r = deleteFile(fullPath, projectPath);
          return `[delete_file ${filePath}]\n${r.success ? '✅ 成功' : '❌ 失败: ' + r.error}`;
        }
        case 'run_shell': {
          const command = (op.content as string) || '';
          return await this.executeShell(command, projectPath);
        }
        default:
          return `[未知操作: ${type}]`;
      }
    } catch (e: any) {
      return `[错误: ${type} ${filePath}]\n${e.message?.slice(0, 500)}`;
    }
  }

  /** Execute a shell command and wait for completion. */
  private executeShell(command: string, cwd: string): Promise<string> {
    return new Promise((resolve) => {
      let output = '';
      const shellId = runShell(
        command,
        cwd,
        (data) => { output += data; },
        (code) => { resolve(`[run_shell]\n$ ${command}\n${output.slice(-3000)}\n[exit ${code}]`); },
        (err) => { resolve(`[run_shell]\n$ ${command}\n[error: ${err}]`); },
      );
      setTimeout(() => {
        killShell(shellId);
        resolve(`[run_shell]\n$ ${command}\n${output.slice(-3000)}\n[timeout]`);
      }, 120000);
    });
  }

  /* ── Planner ── */

  async *planStream(instruction: string, projectPath: string = ''): AsyncGenerator<{ event: string; data: string }> {
    const userMsg = `【用户需求】\n${instruction}\n\n【项目路径】\n${projectPath}\n\n请基于以上信息，直接输出 JSON 执行计划。`;
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
