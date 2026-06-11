import OpenAI from 'openai';
import * as path from 'path';
import {
  listDirectory, readFile, writeFile,
  insertLines, replaceLines, deleteLines, deleteFile,
  searchInFiles, runShell, killShell,
} from '../../fileManager';
import { existsSync } from 'fs';
import { SummarizerService } from './summarizer';
import { getFileSummary } from './db';

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
  - **每条回复只能有 1 个操作标签**，做完这个操作后下一轮再做下一个
  - 当所有任务完成、不需要再使用任何工具时，在回答末尾加上 <final/> 标记
  - <final/> 表示你主动声明完成——没有这个标记，系统会认为你还没做完，会继续追问`;

const PROTOCOL_READONLY = `${PROTOCOL_BASE}

【可用操作 — 只读】
- list-dir: 列出目录内容。path 填相对路径，空或 "." 表示根目录
- search: 搜索代码。标签体内写关键词，path 指定搜索目录（可选）。属性: case-sensitive="true" 区分大小写, whole-word="true" 全词匹配, regex="true" 正则模式
- read-file: 读取文件内容。file 填相对路径，可选 start-line/end-line

<list-dir path="."></list-dir>
<list-dir path="src/"></list-dir>
<search path="src/">关键词</search>
<search path="src/" regex="true">useState\(</search>
<search path="src/" case-sensitive="true" whole-word="true">handleClick</search>
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
<search path="src/" regex="true">useState\(</search>
<search path="src/" case-sensitive="true" whole-word="true">handleClick</search>
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
- **日志辅助诊断：当问题存在多种可能分支、时序依赖或条件竞态，单纯静态分析无法唯一确定根因时，需要在报告中明确指出建议插入日志的位置（文件+函数+行号范围）以及需要打印的关键变量或状态，并解释该日志能排除哪种假设、确认哪种路径，让日志成为连接静态分析和动态验证的桥梁。**
- 节制原则：同一文件的分析结论在单次会话中可复用，除非怀疑该文件已变更；对于调用链末端的简单工具函数或纯数据结构定义，允许直接引用已读结论而不反复打开文件；优先通过搜索定位关键入口，而非通读整个文件。

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

【核心规则 1：统一维度】
所有节点 kind 必须统一，按需求选一个：
- Bug 修复/功能改动 → 函数调用链（kind="function"）
- 模块重构/架构调整 → 模块依赖链（kind="module"）
- UI 交互流程 → 组件树（kind="component"）

【核心规则 2：节点 label 加来源前缀】
根据 file 路径在 label 前面加中文前缀，让读者一眼看出调用链跨越哪些层：
- frontend/src/ → 前缀 [前端]
- electron/ 或 electron/server/ → 前缀 [后端]
- IPC 通道 / 事件 → 前缀 [IPC]
- 第三方库 / node_modules → 前缀 [库]

例如 label: "[前端] handleClose", "[后端] window:close handler", "[IPC] invoke window:close"

【核心规则 3：标注问题位置 — status 字段】
每个节点必须标注 status：
- "existing"：正常代码，不需修改
- "problem"：问题位置。detail 必须包含两部分：①现状（当前有什么问题）②修复（应该改成什么）。例如 detail="现状: 直接调用 app.quit() 跳过生命周期 → 修复: 改为 mainWindow.close() 走正常退出流程"
- "planned_new"：需要新建的文件/函数。detail 描述要新建什么

**注意**：同一个位置有 bug 又要修改的，合并为一个 "problem" 节点，不要拆成两个。每个 Planner step 必须对应至少一个 "problem" 或 "planned_new" 节点。

【核心规则 4：定位行号】
每个节点必须标注 line 字段，值为该函数/类/组件定义的第一行行号：
- 从 read-file 的输出中（带行号前缀）找到定义所在行
- line 为数字类型，不是字符串
- 这是必填字段，用于代码查看器跳转到准确位置

【输出格式】
\`\`\`json
{"call_graph":{"nodes":[{"id":"a","label":"[前端] handleClose","kind":"function","status":"existing","detail":"关闭按钮点击处理","file":"frontend/src/components/TitleBar.tsx","line":47},{"id":"b","label":"[后端] window:close handler","kind":"function","status":"problem","detail":"现状: 直接调用 app.quit() 跳过生命周期 → 修复: 改为 mainWindow.close() 走正常退出流程","file":"electron/main.ts","line":121}],"edges":[{"from":"a","to":"b","label":"IPC invoke","status":"existing"}]}}
\`\`\`

不需要画图时，输出 **skip_map**: true

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

/* ═══════════════════════════════════════════════════════════
   Action system prompts — for the action toolbar
   ═══════════════════════════════════════════════════════════ */

const ACTION_EXPLAIN_PROMPT = `你是 CodeAtlas 的代码文档专家。你的任务是为指定节点生成详细的 Markdown 文档。

【工作流程】
1. 读取节点关联的源代码文件
2. 分析代码逻辑、调用关系、数据流向
3. 输出结构化的 Markdown 文档

【文档必须包含】
- 功能概述与业务背景
- 调用链路分析（上游谁调用了它，它调用了谁）
- 关键函数/类签名与参数说明
- 数据流与状态变更
- 上下游依赖关系
- 边界情况与异常处理

【输出格式】完成分析后直接输出 Markdown，在最后加上 <done>文档生成完成</done>。

${PROTOCOL_READONLY}`;

const ACTION_FIX_PROMPT = `你是 CodeAtlas 的 Bug 修复专家。精确修复指定节点的问题，最小化改动范围。

【铁律】
- 只改与目标节点直接相关的代码，不波及其他模块
- 修改前必须先 read_file 确认当前代码
- 保持与周围代码风格一致
- 改完代码后必须用 <run-shell> 执行项目的编译/类型检查命令（如 npx tsc --noEmit、cargo check 等），确认无语法和类型错误后再输出 <done>

【完成后输出 call_graph】
修改完成后，输出一个 call_graph JSON 描述你的修改：
\`\`\`json
{"call_graph":{"nodes":[...],"edges":[...]}}
\`\`\`
- 被修改的节点 status 设为 "problem"（detail 描述现状→修复）
- 新增的节点 status 设为 "planned_new"
- 最后输出 <done>修复完成</done>

${PROTOCOL_EXECUTE}`;

const ACTION_REFACTOR_PROMPT = `你是 CodeAtlas 的重构专家。以指定节点为起点，重构该节点及其所有下游节点。

【重构原则】
- 改善代码结构而不改变外部行为
- 提取重复逻辑、简化复杂条件、优化命名
- 保持向后兼容，不破坏现有接口
- 先读取所有相关文件再动手
- 重构完成后必须用 <run-shell> 执行项目的编译/类型检查命令，确认重构没有破坏编译/类型系统后再输出 <done>

【范围】重构从目标节点开始，沿调用链向下覆盖所有下游节点。用户会提供下游节点列表。

【完成后输出 call_graph】
重构完成后，输出一个 call_graph JSON 描述重构的节点：
\`\`\`json
{"call_graph":{"nodes":[...],"edges":[...]}}
\`\`\`
- 重构过的节点 status 设为 "problem"（detail 描述重构内容）
- 新增的节点 status 设为 "planned_new"
- 最后输出 <done>重构完成</done>

${PROTOCOL_EXECUTE}`;

const ACTION_TEST_PROMPT = `你是 CodeAtlas 的测试专家。为指定节点及其调用链编写测试。

【流程】
1. 先读取目标节点的源代码，理解功能和边界情况
2. 检查项目是否已有测试框架和测试文件
3. 编写单元测试覆盖核心逻辑、边界情况、异常路径
4. 如有必要，编写集成测试覆盖调用链
5. 用 <run-shell> 运行测试确认通过，如有失败则修复后重新运行

【完成后输出 call_graph】
输出一个 call_graph JSON 描述新增的测试节点和与被测代码的关系：
\`\`\`json
{"call_graph":{"nodes":[...],"edges":[...]}}
\`\`\`
- 新增的测试函数 status 设为 "planned_new"
- 被测函数 status 设为 "existing"
- 最后输出 <done>测试完成</done>

${PROTOCOL_EXECUTE}`;

const ACTION_DEVELOP_PROMPT = `你是 CodeAtlas 的功能开发专家。完成指定新功能节点的开发。

【流程】
1. 读取调用链上游代码，理解现有接口和约定
2. 创建新文件或在新文件中实现功能
3. 建立与上下游的调用关系
4. 确保代码风格和模式与项目一致
5. 开发完成后必须用 <run-shell> 执行项目的编译/类型检查命令，确认新代码通过编译后再输出 <done>

【完成后输出 call_graph】
输出一个 call_graph JSON 描述新功能及其调用关系：
\`\`\`json
{"call_graph":{"nodes":[...],"edges":[...]}}
\`\`\`
- 新增节点 status 设为 "planned_new"
- 上游调用节点 status 设为 "existing"
- 最后输出 <done>开发完成</done>

${PROTOCOL_EXECUTE}`;

const ACTION_SYSTEM_PROMPTS: Record<string, string> = {
  explain: ACTION_EXPLAIN_PROMPT,
  fix: ACTION_FIX_PROMPT,
  refactor: ACTION_REFACTOR_PROMPT,
  test: ACTION_TEST_PROMPT,
  develop: ACTION_DEVELOP_PROMPT,
};

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
  private _summarizer: SummarizerService | null = null;

  private get summarizer(): SummarizerService {
    if (!this._summarizer) {
      this._summarizer = new SummarizerService(async (msgs) => {
        const resp = await this.client.chat.completions.create({
          model: this.model,
          messages: msgs as any,
          temperature: 0.1,
        });
        const content = resp.choices[0].message.content;
        if (!content || content.trim().length === 0) {
          console.log(`[summarizer] LLM returned empty | finish_reason=${resp.choices[0].finish_reason} | usage=${JSON.stringify(resp.usage)} | model=${this.model}`);
        }
        return content || '';
      }, this.model);
    }
    return this._summarizer;
  }

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
    // Copy search-specific attributes (case-sensitive, whole-word, regex)
    if (opType === 'search') {
      for (const k of ['case-sensitive', 'whole-word', 'regex']) {
        if (attrs[k] !== undefined) op[k] = attrs[k];
      }
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
        // Explicit done marker
        if (/<final\/>/i.test(fullText)) {
          const clean = fullText.replace(/<final\/>/gi, '').trim();
          yield { event: 'done', data: JSON.stringify({ message: clean || '完成', operations: [] }) };
          return;
        }
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
        // No tools + no <final/> → might be incomplete, prompt continuation
        messages.push({ role: 'user', content: '请继续（若已完成请追加 <final/>）。' });
        continue;
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
          // Async summarizer: only when reading the full file (no line range)
          if (!op.start_line && !op.end_line && projectPath) {
            this.summarizer.enqueue(projectPath, filePath, result.content, result.lineCount);
          }
          // Attach existing summary if available (path-based lookup)
          let summaryNote = '';
          if (projectPath) {
            try {
              const existing = getFileSummary(projectPath, filePath);
              if (existing) {
                const exports = existing.key_exports?.length
                  ? existing.key_exports.map((e: any) => `${e.kind} ${e.name}() L${e.line}`).join(', ')
                  : '无';
                summaryNote = `\n【已有摘要】${existing.summary} (共${existing.total_lines || '?'}行)\n关键导出: ${exports}\n`;
              }
            } catch { /* ignore */ }
          }
          // Add line numbers so the LLM can reference specific lines
          const numbered = result.lines
            .map((l: string, i: number) => `${String(startLine + i).padStart(4, ' ')}| ${l}`)
            .join('\n');
          const truncated = this.truncate(numbered, 12000);
          return `${summaryNote}[read_file ${filePath} L${startLine}${endLine ? `-L${endLine}` : `-L${startLine + result.lineCount - 1}`} (${result.lineCount} lines)]\n\`\`\`\n${truncated}\n\`\`\``;
        }
        case 'search': {
          const query = (op.content as string) || '';
          const searchPath = filePath ? fullPath : projectPath;
          const results = await searchInFiles(query, searchPath, {
            caseSensitive: op['case-sensitive'] === 'true' || op.case_sensitive === true,
            wholeWord: op['whole-word'] === 'true' || op.whole_word === true,
            useRegex: op['regex'] === 'true' || op.regex === true,
          });
          const flags = [];
          if (op['case-sensitive'] === 'true') flags.push('case-sensitive');
          if (op['whole-word'] === 'true') flags.push('whole-word');
          if (op['regex'] === 'true') flags.push('regex');
          const flagStr = flags.length > 0 ? ` (${flags.join(', ')})` : '';
          const summary = results.map((r) => `${r.file}:${r.line}  ${r.text}`).join('\n');
          return `[search "${query}" in ${filePath || '.'}${flagStr}]\n${summary.slice(0, 12000) || '(无匹配结果)'}`;
        }
        case 'insert_lines': {
          const afterLine = (op.after_line as number) || 0;
          const content = (op.content as string) || '';
          const r = await insertLines(fullPath, afterLine, content);
          return `[insert_lines ${filePath} after L${afterLine}]\n${r.success ? '✅ 成功' : '❌ 失败: ' + r.error}`;
        }
        case 'replace_lines': {
          const startLine = (op.start_line as number) || 1;
          const endLine = (op.end_line as number) || 1;
          const content = (op.content as string) || '';
          const r = await replaceLines(fullPath, startLine, endLine, content);
          return `[replace_lines ${filePath} L${startLine}-L${endLine}]\n${r.success ? '✅ 成功' : '❌ 失败: ' + r.error}`;
        }
        case 'delete_lines': {
          const startLine = (op.start_line as number) || 1;
          const endLine = (op.end_line as number) || 1;
          const r = await deleteLines(fullPath, startLine, endLine);
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

  /* ── Action stream ── */

  async *runActionStream(req: {
    action: string;
    node: Record<string, unknown>;
    instruction?: string;
    project_path: string;
    downstream_nodes?: Record<string, unknown>[];
  }): AsyncGenerator<{ event: string; data: string }> {
    const { action, node, instruction, project_path, downstream_nodes } = req;
    const projectPath = project_path || '';

    // Phase 1: Action agent
    yield { event: 'phase', data: JSON.stringify({ phase: 'action', action }) };

    const systemPrompt = ACTION_SYSTEM_PROMPTS[action] || PROTOCOL_EXECUTE;
    const isReadOnly = action === 'explain';

    // Build user message
    const parts: string[] = [];
    parts.push(`【任务类型】${action}`);
    parts.push(`【目标节点】`);
    parts.push(`  - 名称: ${node.label || '(未知)'}`);
    parts.push(`  - 类型: ${node.kind || 'function'}`);
    parts.push(`  - 状态: ${node.status || 'existing'}`);
    if (node.detail) parts.push(`  - 描述: ${node.detail}`);
    if (node.file) parts.push(`  - 文件: ${node.file}${node.line ? `:${node.line}` : ''}`);
    parts.push(`【项目路径】${projectPath}`);

    if (downstream_nodes && downstream_nodes.length > 0) {
      parts.push(`【下游节点列表】(共${downstream_nodes.length}个)`);
      for (const dn of downstream_nodes) {
        parts.push(`  - ${dn.label || '(未知)'} [${dn.kind || 'function'}] ${dn.file ? `@ ${dn.file}` : ''}`);
      }
    }

    if (instruction) {
      parts.push(`【用户补充说明】${instruction}`);
    }

    if (isReadOnly) {
      parts.push(`\n请读取相关文件并直接输出文档内容。`);
    } else {
      parts.push(`\n请开始处理。先读取相关文件，然后执行修改。`);
    }

    const userMsg = parts.join('\n');
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMsg },
    ];

    // ── Tool loop ──
    let turn = 0;
    let emptyCount = 0;
    let madeChanges = false;
    let finalMessage = '';
    let actionSuccess = false;
    const WRITE_OPS = new Set(['insert_lines', 'replace_lines', 'delete_lines', 'create_file', 'delete_file']);

    while (turn < 30) {
      turn++;

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
        yield { event: 'done', data: JSON.stringify({ success: false, message: `处理出错: ${e.message?.slice(0, 200)}`, review_passed: null }) };
        return;
      }

      // Parse operations
      let operations: Record<string, unknown>[] = [];
      let agentMessage = fullText;
      try {
        const parsed = this.parseXmlLike(fullText);
        operations = parsed.operations;
        agentMessage = parsed.message;
      } catch {
        // No XML ops — might be final output
      }

      messages.push({ role: 'assistant', content: fullText });

      if (operations.length === 0) {
        // Check for done / final tags
        if (/<done>/i.test(fullText) || /<final\/>/i.test(fullText) || /文档生成完成/.test(fullText)) {
          finalMessage = fullText.replace(/<final\/>/gi, '').replace(/<done>[^<]*<\/done>/gi, '').trim();
          actionSuccess = true;
          break;
        }
        if (fullText.trim().length < 5) {
          emptyCount++;
          if (emptyCount >= 3) {
            finalMessage = 'LLM 连续返回空响应';
            break;
          }
          messages.push({ role: 'user', content: '请继续。' });
          continue;
        }
        emptyCount = 0;
        // No ops and no done tag — probably final output
        finalMessage = agentMessage;
        actionSuccess = true;
        break;
      }
      emptyCount = 0;

      // Track write operations
      for (const op of operations) {
        if (WRITE_OPS.has(op.type as string)) {
          madeChanges = true;
          break;
        }
      }

      // Yield tool info
      yield {
        event: 'tools',
        data: JSON.stringify({ count: operations.length, ops: operations.map((o) => ({ type: o.type, file: o.file })) }),
      };

      // Execute tools
      let toolResults = '';
      for (const op of operations) {
        const result = await this.executeTool(op, projectPath);
        toolResults += result + '\n\n';
      }

      // Feed results back
      messages.push({
        role: 'user',
        content: `【工具执行结果】\n${toolResults.trim()}\n\n请基于以上结果继续处理。`,
      });
    }

    if (turn >= 30) {
      yield { event: 'done', data: JSON.stringify({ success: false, message: '已达到最大轮次限制', review_passed: null }) };
      return;
    }

    if (!actionSuccess) {
      yield { event: 'done', data: JSON.stringify({ success: false, message: finalMessage || '处理未完成', review_passed: null }) };
      return;
    }

    // Phase 2: Reviewer (only for write actions that made changes)
    if (madeChanges && !isReadOnly) {
      yield { event: 'phase', data: JSON.stringify({ phase: 'review' }) };

      const reviewMsg = `【审查任务】
你是一位独立代码审查者。刚才执行了"${action}"操作，目标是节点"${node.label || '(未知)'}"。

请读取被修改的文件，验证：
1. 修改是否正确完成了任务
2. 代码风格是否与项目一致
3. 是否引入了新的问题
4. 边界情况是否处理得当

输出 JSON：
{"passed": true/false, "feedback": "一句话总结", "issues": [{"severity": "critical|high|medium|low", "file": "...", "claim": "...", "reality": "..."}]}`;

      const reviewMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: REVIEWER_EXEC_SYSTEM_PROMPT },
        { role: 'user', content: reviewMsg },
      ];

      let reviewText = '';
      try {
        const reviewStream = await this.client.chat.completions.create({
          model: this.model,
          messages: reviewMessages,
          temperature: 0.0,
          stream: true,
        });

        for await (const chunk of reviewStream) {
          const delta = (chunk.choices[0]?.delta as any) || {};
          const token = delta.content || delta.reasoning_content || '';
          if (token) {
            reviewText += token;
            yield { event: 'review_token', data: token };
          }
        }
      } catch (e: any) {
        yield { event: 'done', data: JSON.stringify({ success: true, message: finalMessage || '完成', review_passed: null, review_error: e.message }) };
        return;
      }

      // Parse reviewer output
      let reviewPassed: boolean | null = null;
      let reviewFeedback = '';
      let reviewIssues: unknown[] = [];
      try {
        const cleaned = reviewText.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
        const reviewJson = JSON.parse(cleaned.match(/\{[\s\S]*"passed"[\s\S]*\}/)?.[0] || cleaned);
        reviewPassed = !!reviewJson.passed;
        reviewFeedback = reviewJson.feedback || '';
        reviewIssues = reviewJson.issues || [];
      } catch {
        // If can't parse JSON, check for PASSED/FAILED
        reviewPassed = /PASSED/i.test(reviewText) && !/FAILED/i.test(reviewText);
        reviewFeedback = reviewText;
      }

      // Try to extract call_graph from action agent output
      let callGraph: unknown = null;
      try {
        const jsonMatch = finalMessage.match(/\{[\s\S]*"call_graph"[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          callGraph = parsed.call_graph || null;
        }
      } catch { /* ignore parse errors */ }

      yield {
        event: 'done',
        data: JSON.stringify({
          success: true,
          message: finalMessage || '完成',
          review_passed: reviewPassed,
          review_feedback: reviewFeedback,
          review_issues: reviewIssues,
          call_graph: callGraph,
        }),
      };
      return;
    }

    // Try to extract call_graph from action agent output (no reviewer path)
    let callGraph2: unknown = null;
    try {
      const jsonMatch = finalMessage.match(/\{[\s\S]*"call_graph"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        callGraph2 = parsed.call_graph || null;
      }
    } catch { /* ignore */ }

    // No reviewer needed (read-only or no changes)
    yield {
      event: 'done',
      data: JSON.stringify({
        success: true,
        message: finalMessage || '完成',
        review_passed: null,
        call_graph: callGraph2,
      }),
    };
  }
}

export const agentService = new AgentService();
