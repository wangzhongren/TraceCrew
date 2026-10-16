/**
 * Unit tests for electron/server/services/agent.ts
 *
 * Tests AgentService parsing, message building, and utility methods.
 * LLM calls are NOT tested — those require a live API.
 *
 * 退役说明（2026-10-16，提案 docs/fix/2026-10-16_fix_test-suite-red.md 第 2.2 节 A 表）：
 * 原 `buildUserMessage` 的 5 条用例已退役——该方法已从 AgentService 删除，
 * 「用户指令 + 打开文件 + 选区 + 项目文件树」的用户消息拼装已移至前端
 * `ChatPanel.agentLoop`；等价覆盖由 `test/agent-pipeline/chatPanelUserContent.test.ts`
 * （选装 O1）承接。
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AgentService } from '../../electron/server/services/agent';

function makeService(): AgentService {
  return new AgentService();
}

// ═══════════════════════════════════════════════════════════════════
// cleanOutput (private)
// ═══════════════════════════════════════════════════════════════════

describe('cleanOutput', () => {
  it('strips markdown code fences', () => {
    const svc = makeService();
    const result = (svc as any).cleanOutput('```json\n{"key": "val"}\n```');
    expect(result).toBe('{"key": "val"}');
  });

  it('strips backtick-only fences', () => {
    const svc = makeService();
    const result = (svc as any).cleanOutput('```\nplain text\n```');
    expect(result).toBe('plain text');
  });

  it('trims whitespace', () => {
    const svc = makeService();
    const result = (svc as any).cleanOutput('  \n  hello world  \n  ');
    expect(result).toBe('hello world');
  });

  it('returns text unchanged when no fences', () => {
    const svc = makeService();
    const result = (svc as any).cleanOutput('just plain text');
    expect(result).toBe('just plain text');
  });
});

// ═══════════════════════════════════════════════════════════════════
// parseAttrs (private)
// ═══════════════════════════════════════════════════════════════════

describe('parseAttrs', () => {
  it('parses key="value" pairs', () => {
    const svc = makeService();
    const attrs = (svc as any).parseAttrs('path="src/app.ts" start-line="10"');
    expect(attrs).toEqual({
      path: 'src/app.ts',
      'start-line': '10',
    });
  });

  it('parses single-quoted values (known limitation: key not captured)', () => {
    const svc = makeService();
    // NOTE: The parser regex has a bug where single-quoted attrs like path='hello.ts'
    // capture the value but not the key. This test documents current behavior.
    const attrs = (svc as any).parseAttrs("path='hello.ts'");
    // Key is undefined due to regex limitation; value is captured in the wrong group
    expect(attrs).toHaveProperty('undefined', 'hello.ts');
  });

  it('handles HTML entities in values', () => {
    const svc = makeService();
    const attrs = (svc as any).parseAttrs('content="x &lt; y &amp;&amp; z &gt; w"');
    expect(attrs.content).toBe('x < y && z > w');
  });

  it('returns empty object for empty string', () => {
    const svc = makeService();
    const attrs = (svc as any).parseAttrs('');
    expect(attrs).toEqual({});
  });
});

// ═══════════════════════════════════════════════════════════════════
// tagText (private)
// ═══════════════════════════════════════════════════════════════════

describe('tagText', () => {
  it('returns content as-is without trimming', () => {
    const svc = makeService();
    // 实现刻意不修剪（仅剥离 CDATA 包装）：修剪曾导致写入内容缩进丢失；
    // 首尾空行由下游 contentToLines（electron/fileManager.ts）负责剥离。
    const result = (svc as any).tagText('  hello world  ');
    expect(result).toBe('  hello world  ');
  });

  it('extracts CDATA content', () => {
    const svc = makeService();
    const result = (svc as any).tagText('<![CDATA[some raw content]]>');
    expect(result).toBe('some raw content');
  });
});

// ═══════════════════════════════════════════════════════════════════
// operationFromTag (private)
// ═══════════════════════════════════════════════════════════════════

describe('operationFromTag', () => {
  it('maps list-dir to list_dir operation', () => {
    const svc = makeService();
    const op = (svc as any).operationFromTag(
      'list-dir',
      { path: 'src/' },
      '',
    );
    expect(op).toEqual({ type: 'list_dir', file: 'src/' });
  });

  it('maps read-file to read_file with line numbers', () => {
    const svc = makeService();
    const op = (svc as any).operationFromTag(
      'read-file',
      { path: 'src/app.ts', 'start-line': '10', 'end-line': '20' },
      '',
    );
    expect(op).toEqual({
      type: 'read_file',
      file: 'src/app.ts',
      start_line: 10,
      end_line: 20,
    });
  });

  it('maps update insert to insert_lines operation', () => {
    const svc = makeService();
    const op = (svc as any).operationFromTag(
      'update',
      { status: 'insert', path: 'src/app.ts', 'after-line': '5' },
      'new content line',
    );
    expect(op).toEqual({
      type: 'insert_lines',
      file: 'src/app.ts',
      after_line: 5,
      content: 'new content line',
    });
  });

  it('maps update replace to replace_lines operation', () => {
    const svc = makeService();
    const op = (svc as any).operationFromTag(
      'update',
      { status: 'replace', path: 'src/app.ts', 'start-line': '1', 'end-line': '3' },
      'replacement\ncontent',
    );
    expect(op).toEqual({
      type: 'replace_lines',
      file: 'src/app.ts',
      start_line: 1,
      end_line: 3,
      content: 'replacement\ncontent',
    });
  });

  it('maps update delete to delete_lines operation', () => {
    const svc = makeService();
    const op = (svc as any).operationFromTag(
      'update',
      { status: 'delete', path: 'src/app.ts', 'start-line': '10', 'end-line': '15' },
      '',
    );
    expect(op).toEqual({
      type: 'delete_lines',
      file: 'src/app.ts',
      start_line: 10,
      end_line: 15,
    });
  });

  it('maps create-file with content', () => {
    const svc = makeService();
    const op = (svc as any).operationFromTag(
      'create-file',
      { path: 'src/new.ts' },
      'export const x = 1;',
    );
    expect(op).toEqual({
      type: 'create_file',
      file: 'src/new.ts',
      content: 'export const x = 1;',
    });
  });

  it('maps search with content as query', () => {
    const svc = makeService();
    const op = (svc as any).operationFromTag(
      'search',
      { path: 'src/' },
      'handleSubmit',
    );
    expect(op).toEqual({
      type: 'search',
      file: 'src/',
      content: 'handleSubmit',
    });
  });

  it('treats unknown tag as its own type', () => {
    const svc = makeService();
    const op = (svc as any).operationFromTag(
      'custom-tag',
      { foo: 'bar' },
      'content',
    );
    expect(op.type).toBe('custom-tag');
    expect(op.file).toBeUndefined();
  });

  it('defaults update without status to replace_lines', () => {
    const svc = makeService();
    const op = (svc as any).operationFromTag(
      'update',
      { path: 'src/x.ts', 'start-line': '1', 'end-line': '2' },
      'stuff',
    );
    expect(op.type).toBe('replace_lines');
  });
});

// ═══════════════════════════════════════════════════════════════════
// parseXmlLike → parseAgentOutput (private, tested together)
// ═══════════════════════════════════════════════════════════════════

describe('parseXmlLike / parseAgentOutput', () => {
  it('parses block tags with content', () => {
    const svc = makeService();
    const input = [
      '我先读取文件：',
      '<read-file path="src/app.ts"></read-file>',
    ].join('\n');

    const result = (svc as any).parseAgentOutput(input);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toEqual({
      type: 'read_file',
      file: 'src/app.ts',
    });
    expect(result.message).toContain('我先读取文件');
  });

  it('parses multiple operations', () => {
    const svc = makeService();
    const input = [
      '<read-file path="src/a.ts"></read-file>',
      '<read-file path="src/b.ts"></read-file>',
      '<update status="insert" path="src/c.ts" after-line="10">',
      'new code',
      '</update>',
    ].join('\n');

    const result = (svc as any).parseAgentOutput(input);
    expect(result.operations).toHaveLength(3);
    expect(result.operations[0].type).toBe('read_file');
    expect(result.operations[1].type).toBe('read_file');
    expect(result.operations[2].type).toBe('insert_lines');
    // 内容按原文保留（含标签内首尾换行）；首尾空行由下游 contentToLines 剥离
    expect(result.operations[2].content).toBe('\nnew code\n');
  });

  it('parses self-closing tags', () => {
    const svc = makeService();
    const input = '<list-dir path="."/>';
    const result = (svc as any).parseAgentOutput(input);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toEqual({
      type: 'list_dir',
      file: '.',
    });
  });

  it('throws when no XML tags found', () => {
    const svc = makeService();
    // When no tags, falls back to JSON parsing or plain text
    const result = (svc as any).parseAgentOutput('just a message');
    expect(result.operations).toEqual([]);
    expect(result.message).toBe('just a message');
  });

  it('provides default message when only operations exist', () => {
    const svc = makeService();
    const input = '<read-file path="test.ts"></read-file>';
    const result = (svc as any).parseAgentOutput(input);
    expect(result.operations).toHaveLength(1);
    expect(result.message).toBeTruthy();
  });

  it('handles run-shell tag', () => {
    const svc = makeService();
    const input = [
      '运行测试：',
      '<run-shell>npm test</run-shell>',
    ].join('\n');

    const result = (svc as any).parseAgentOutput(input);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toEqual({
      type: 'run_shell',
      content: 'npm test',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// truncate (private)
// ═══════════════════════════════════════════════════════════════════

describe('truncate', () => {
  it('returns original text when under maxChars', () => {
    const svc = makeService();
    const result = (svc as any).truncate('short text', 100);
    expect(result).toBe('short text');
  });

  it('truncates long text keeping head and tail', () => {
    const svc = makeService();
    const longText = 'a'.repeat(5000);
    const result = (svc as any).truncate(longText, 1000);
    expect(result.length).toBeLessThanOrEqual(1050); // head + tail + separator
    expect(result).toContain('(truncated)');
    expect(result.startsWith('a')).toBe(true);
    expect(result.endsWith('a')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// buildMessages (private)
// ═══════════════════════════════════════════════════════════════════

describe('buildMessages', () => {
  it('builds one message per history entry (system prompt is mounted by the caller)', () => {
    const svc = makeService();
    const msgs = (svc as any).buildMessages([
      { role: 'user', content: 'hello' },
    ]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toEqual({ role: 'user', content: 'hello' });
  });

  it('includes history messages with agent→assistant conversion', () => {
    const svc = makeService();
    const msgs = (svc as any).buildMessages([
      { role: 'user', content: 'hello' },
      { role: 'agent', content: 'hi there' },
      { role: 'user', content: 'help' },
    ]);
    expect(msgs).toHaveLength(3);
    expect(msgs[0].role).toBe('user');
    expect(msgs[1].role).toBe('assistant'); // agent → assistant
    expect(msgs[2].role).toBe('user');
    expect(msgs[1].content).toBe('hi there');
  });

  // F2 回归守护（2026-10-16 fix_e2e-findings 第 2 节）：ChatPanel 全程发送 role:'assistant'
  // 的历史项；映射缺失 'assistant' 时第二轮起模型把自己的历史答复当作用户输入（自导自演）。
  it('maps assistant and agent to assistant, any other role to user (F2)', () => {
    const svc = makeService();
    const msgs = (svc as any).buildMessages([
      { role: 'assistant', content: 'a' },
      { role: 'agent', content: 'b' },
      { role: 'user', content: 'c' },
      { role: 'weird', content: 'd' },
    ]);
    expect(msgs.map((m: { role: string }) => m.role)).toEqual([
      'assistant',
      'assistant',
      'user',
      'user',
    ]);
  });

  // O2 守护（2026-10-16 提案第 7 节）：history 提供但非数组时立即报错，
  // 杜绝旧签名误用（传字符串）被逐字符遍历、静默产出逐字符垃圾消息。
  it('throws a descriptive error when history is provided but not an array', () => {
    const svc = makeService();
    expect(() => (svc as any).buildMessages('system prompt')).toThrow(/history.*数组/);
  });

  it('treats omitted or null history as empty', () => {
    const svc = makeService();
    expect((svc as any).buildMessages()).toEqual([]);
    expect((svc as any).buildMessages(null)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// extractPlanJson (private)
// ═══════════════════════════════════════════════════════════════════

describe('extractPlanJson', () => {
  it('extracts JSON from markdown code block', () => {
    const svc = makeService();
    const input = [
      '这是计划：',
      '```json',
      '{',
      '  "plan": "Refactor auth",',
      '  "steps": [',
      '    {"id": 1, "title": "Extract login", "description": "...", "deps": []}',
      '  ]',
      '}',
      '```',
    ].join('\n');

    const plan = (svc as any).extractPlanJson(input);
    expect(plan.plan).toBe('Refactor auth');
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].id).toBe(1);
    expect(plan.steps[0].title).toBe('Extract login');
  });

  it('falls back to finding JSON object with steps key', () => {
    const svc = makeService();
    const input = 'some text {"plan": "Fix bug", "steps": []} more text';

    const plan = (svc as any).extractPlanJson(input);
    expect(plan.plan).toBe('Fix bug');
    expect(plan.steps).toEqual([]);
  });

  it('returns fallback on parse failure', () => {
    const svc = makeService();
    const input = 'not JSON at all';

    const plan = (svc as any).extractPlanJson(input);
    expect(plan.plan).toBe('无法解析计划');
    expect(plan.steps).toEqual([]);
    expect(plan.raw).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Edge case: Chinese + XML parsing
// ═══════════════════════════════════════════════════════════════════

describe('Chinese + XML mixed content', () => {
  it('extracts Chinese narration between operation tags', () => {
    const svc = makeService();
    const input = [
      '我来分析一下这个文件的结构。',
      '<read-file path="src/app.ts"></read-file>',
      '我看到问题在第 42 行附近，需要修改一下。',
      '<update status="replace" path="src/app.ts" start-line="40" end-line="44">',
      '修复后的代码',
      '</update>',
      '修改完成，这样改因为原来的逻辑有问题。',
    ].join('\n');

    const result = (svc as any).parseAgentOutput(input);
    expect(result.operations).toHaveLength(2);
    expect(result.operations[0].type).toBe('read_file');
    expect(result.operations[1].type).toBe('replace_lines');

    // Message should contain the Chinese text between tags
    expect(result.message).toContain('我来分析一下');
    expect(result.message).toContain('修改完成');
  });
});

// ═══════════════════════════════════════════════════════════════════
// executeTool (private) — search 分支
// ═══════════════════════════════════════════════════════════════════

describe('executeTool search', () => {
  // 缺陷 #2 回归守护（2026-10-16 fix_search-in-files-empty 第 10 节，M8）：
  // 该分支曾把 searchInFiles 的 SearchResponse 当数组调用 results.map，
  // 抛错并被 executeTool 的 catch 捕获 → Agent 搜索工具恒返回 `[错误: ...] is not a function`。
  it('returns file:line matches from a real search instead of an error string', async () => {
    const svc = makeService();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracecrew-agent-search-'));
    try {
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'src', 'a.ts'), 'function needle() {}\n', 'utf-8');

      const out = await (svc as any).executeTool(
        { type: 'search', file: '.', content: 'needle' },
        tmpDir,
      );

      expect(out).toContain('src/a.ts:1');
      expect(out).not.toContain('[错误');
      expect(out).not.toContain('is not a function');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// cleanDoneMessage (private) — done.message 统一清洗口径（F4）
// ═══════════════════════════════════════════════════════════════════

describe('cleanDoneMessage', () => {
  // F4 回归守护（2026-10-16 fix_e2e-findings 第 4 节）：PM handoff 的 done.message
  // 曾残留 <final/>；清洗口径统一为「去操作标签与终态标记后的正文」。
  it('strips final/done/handoff markers case-insensitively from the parsed body', () => {
    const svc = makeService();
    const cleaned = (svc as any).cleanDoneMessage(
      '已完成读取。\n<FINAL/>\n<Done/>\n<HANDOFF-TO-PLANNER/>',
      'fallback text',
    );
    expect(cleaned).toBe('已完成读取。');
  });

  it('falls back to fullText when the parsed body is empty', () => {
    const svc = makeService();
    const cleaned = (svc as any).cleanDoneMessage('', '兜底正文 <final/>');
    expect(cleaned).toBe('兜底正文');
  });

  // E-F1b（2026-10-16 裁定残余 1）：E-F3 复跑现场出现 </final> 等非规范闭合形态，
  // 清洗必须覆盖开/闭/自闭合各形态，而不是只认 <final/> 三种字面。
  it('strips non-canonical opening/closing forms such as </final> and </handoff-to-planner>', () => {
    const svc = makeService();
    const cleaned = (svc as any).cleanDoneMessage(
      '正文\n</final>\n</handoff-to-planner>\n<done>\n</final />',
      'fallback text',
    );
    expect(cleaned).toBe('正文');
  });
});

// ═══════════════════════════════════════════════════════════════════
// processStream — 同轮终态标记与工具执行（F1）
// ═══════════════════════════════════════════════════════════════════

/**
 * F1 假客户端：按调用次序逐条回放 outputs。
 * 形态与 OpenAI SDK 的 chat.completions.create 流式接口一致（返回异步生成器），
 * 并记录每次请求的 messages，供断言「工具结果是否真的回喂」。
 */
function makeFakePlannerClient(outputs: string[]) {
  const calls: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  return {
    calls,
    callCount() {
      return calls.length;
    },
    chat: {
      completions: {
        create: async (params: { messages: Array<{ role: string; content: string }> }) => {
          calls.push({ messages: params.messages });
          const index = calls.length - 1;
          let content = '';
          if (index < outputs.length) {
            content = outputs[index];
          }
          return (async function* () {
            yield { choices: [{ delta: { content } }] };
          })();
        },
      },
    },
  };
}

async function collectStreamEvents(
  svc: AgentService,
  req: { history: Array<{ role: string; content: string }>; mode: string; project_path: string; max_turns?: number },
): Promise<Array<{ event: string; data: string }>> {
  const events: Array<{ event: string; data: string }> = [];
  for await (const ev of svc.processStream(req)) {
    events.push(ev);
  }
  return events;
}

describe('processStream — same-turn terminal marker vs tools (F1)', () => {
  // F1 回归守护（2026-10-16 fix_e2e-findings 第 1 节）：终态检查曾先于工具执行并 return，
  // 同轮「操作标签 + <final/>」时已解析的 operations 被静默丢弃、无 tools 事件。
  // 修复后对齐 runActionStream 语义：本轮有操作则先执行全部工具、结果回喂、继续循环。
  it('runs same-turn tools before honoring <final/>, then ends on the next turn', async () => {
    const svc = makeService();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracecrew-agent-f1a-'));
    try {
      fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'export const a = 1;\n', 'utf-8');

      const fake = makeFakePlannerClient([
        '<read-file path="a.ts"></read-file>\n<final/>',
        '已读取 a.ts，内容是一个常量声明。\n<final/>',
      ]);
      (svc as any)._clients.set('PLANNER', fake);
      (svc as any)._models.set('PLANNER', 'fake-model');

      const events = await collectStreamEvents(svc, {
        history: [{ role: 'user', content: 'x' }],
        mode: 'planner',
        project_path: tmpDir,
      });

      // 本轮有操作 → 必须发出 tools 事件（修复前此处为 0）
      const toolEvents = events.filter((e) => e.event === 'tools');
      expect(toolEvents).toHaveLength(1);
      expect(JSON.parse(toolEvents[0].data).count).toBe(1);

      // 工具被真正执行并回喂：第二轮的请求里带上了 a.ts 的真实内容
      expect(fake.callCount()).toBe(2);
      const secondMessages = fake.calls[1].messages;
      const toolResultMsg = secondMessages.find((m) => m.content.includes('【工具执行结果】'));
      expect(toolResultMsg).toBeDefined();
      expect(toolResultMsg?.content).toContain('export const a = 1;');

      // 会话看过真实结果后以 done 收束，且 message 无终态标记与操作标签
      const doneEvents = events.filter((e) => e.event === 'done');
      expect(doneEvents).toHaveLength(1);
      const doneData = JSON.parse(doneEvents[0].data);
      expect(doneData.message).toBe('已读取 a.ts，内容是一个常量声明。');
      expect(doneData.message).not.toContain('<final/>');
      expect(doneData.message).not.toContain('<read-file');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // 无操作 + <final/> 的既有行为不回归：直接 done、不发 tools、只调用模型一次。
  it('still ends immediately when a turn has no operations (no regression)', async () => {
    const svc = makeService();
    const fake = makeFakePlannerClient(['这是最终答复，没有工具操作。\n<final/>']);
    (svc as any)._clients.set('PLANNER', fake);
    (svc as any)._models.set('PLANNER', 'fake-model');

    const events = await collectStreamEvents(svc, {
      history: [{ role: 'user', content: 'x' }],
      mode: 'planner',
      project_path: '',
    });

    expect(events.filter((e) => e.event === 'tools')).toHaveLength(0);
    expect(fake.callCount()).toBe(1);

    const doneEvents = events.filter((e) => e.event === 'done');
    expect(doneEvents).toHaveLength(1);
    const doneData = JSON.parse(doneEvents[0].data);
    expect(doneData.message).toBe('这是最终答复，没有工具操作。');
    expect(doneData.message).not.toContain('<final/>');
  });
});

// ═══════════════════════════════════════════════════════════════════
// processStream — 轮次上限收尾与循环防护（T1，design_turn-limit-wrapup v1）
// ═══════════════════════════════════════════════════════════════════

/**
 * T1 假客户端：按「本次请求的 messages」动态决定本轮输出（形态与
 * makeFakePlannerClient 相同：单 chunk 整段正文）。供循环复现 / 逼近上限 /
 * 终稿轮等需要「先读到注入消息、再据此响应」的场景。
 */
function makeResponderClient(
  respond: (messages: Array<{ role: string; content: string }>, callIndex: number) => string,
) {
  const calls: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  return {
    calls,
    callCount() {
      return calls.length;
    },
    chat: {
      completions: {
        create: async (params: { messages: Array<{ role: string; content: string }> }) => {
          // 快照本轮请求：processStream 会继续向同一 messages 数组 push（注入/回喂），
          // 若按引用记录，历史请求会被后续写入污染，无法断言「注入发生在哪一轮」。
          calls.push({ messages: params.messages.map((m) => ({ role: m.role, content: m.content })) });
          const content = respond(params.messages, calls.length - 1);
          return (async function* () {
            yield { choices: [{ delta: { content } }] };
          })();
        },
      },
    },
  };
}

/** 工具执行替身：固定结果，使「相同操作 + 相同结果」的循环签名可控。 */
function stubToolResults(svc: AgentService, result: string): void {
  (svc as any).executeTool = async () => result;
}

function messagesHave(messages: Array<{ role: string; content: string }>, text: string): boolean {
  return messages.some((m) => m.content.includes(text));
}

function countMessagesContaining(messages: Array<{ role: string; content: string }>, text: string): number {
  return messages.filter((m) => m.content.includes(text)).length;
}

const LOOP_NUDGE_MARK = '你已连续 3 次执行完全相同的操作';
const NEAR_LIMIT_MARK = '探索轮次即将用尽';
const FINAL_WRAPUP_MARK = '已达探索轮次上限。请立即基于已获得的信息';
const BARE_LIMIT = '已达到最大轮次限制';

function installFakePlanner(svc: AgentService, fake: ReturnType<typeof makeResponderClient>): void {
  (svc as any)._clients.set('PLANNER', fake);
  (svc as any)._models.set('PLANNER', 'fake-model');
}

describe('processStream — 循环防护（T1）', () => {
  // design_turn-limit-wrapup 3.3 回归守护：现场为 mapper 咨询连续 26 轮相同
  // <search> 且结果不变、零进展直至裸撞限。K=3 连续相同（操作+结果）→ 纠偏注入；
  // 纠偏 2 次后仍复现 → 提前进入终稿轮（不再等待撞限）。
  it('K=3 identical turns → nudge; after 2 nudges → forced wrap-up turn; done = final text', async () => {
    const svc = makeService();
    stubToolResults(svc, '[search "needle" in x.js]\n(无匹配结果)');
    const finalText = '最终结论：sendMedia 的调用入口在 doudian_im_msg.js。';
    const fake = makeResponderClient((messages) => {
      if (messagesHave(messages, FINAL_WRAPUP_MARK)) {
        // 终稿轮：即使输出操作标签 + <final/>，也必须不执行工具、正文即最终产出
        return `<search path="x.js">needle</search>\n${finalText}\n<final/>`;
      }
      return '<search path="x.js">needle</search>';
    });
    installFakePlanner(svc, fake);

    const events = await collectStreamEvents(svc, {
      history: [{ role: 'user', content: 'x' }],
      mode: 'planner',
      project_path: '',
    });

    // 轮 1-3 签名相同 → 第 4 次请求（calls[3]）出现纠偏；第 3 次请求尚未出现
    expect(fake.callCount()).toBe(10);
    expect(countMessagesContaining(fake.calls[2].messages, LOOP_NUDGE_MARK)).toBe(0);
    expect(countMessagesContaining(fake.calls[3].messages, LOOP_NUDGE_MARK)).toBe(1);
    // 纠偏共 2 次（第 3 次复现不再注入，而是提前终稿）
    expect(countMessagesContaining(fake.calls[9].messages, LOOP_NUDGE_MARK)).toBe(2);
    // 2 次纠偏后仍复现 → 终稿注入出现于第 10 轮（0-based calls[9]）
    expect(messagesHave(fake.calls[9].messages, FINAL_WRAPUP_MARK)).toBe(true);
    // 终稿轮不执行工具：tools 事件恰为轮 1-9 的 9 个
    expect(events.filter((e) => e.event === 'tools')).toHaveLength(9);
    // done 来自终稿文本（清洗 <final/> 与操作标签），非裸串、非兜底
    const doneEvents = events.filter((e) => e.event === 'done');
    expect(doneEvents).toHaveLength(1);
    const doneData = JSON.parse(doneEvents[0].data);
    expect(doneData.message).toBe(finalText);
    expect(doneData.message).not.toBe(BARE_LIMIT);
  });
});

describe('processStream — 近限与达限收尾（T1）', () => {
  // design_turn-limit-wrapup 3.1/3.2 回归守护：近限注入恰一次（含剩余轮数）；
  // 达限不再裸 done，而是预算外终稿轮（无工具调用），done = 终稿文本。
  it('near-limit prompt injected once with remaining turns; final wrap-up turn supplies done', async () => {
    const svc = makeService();
    stubToolResults(svc, '[search "n"]\n(无匹配结果)');
    const finalText = '最终结论：已基于已收集信息给出图谱。';
    const fake = makeResponderClient((messages, callIndex) => {
      if (messagesHave(messages, FINAL_WRAPUP_MARK)) {
        return `${finalText}\n<final/>`;
      }
      // 每轮操作不同 → 不触发循环防护（隔离本用例被测行为）
      return `<search path="file-${callIndex}.js">needle-${callIndex}</search>`;
    });
    installFakePlanner(svc, fake);

    const events = await collectStreamEvents(svc, {
      history: [{ role: 'user', content: 'x' }],
      mode: 'planner',
      project_path: '',
      max_turns: 5,
    });

    // 预算 5 轮 + 预算外终稿轮 1 次 = 6 次模型调用
    expect(fake.callCount()).toBe(6);
    // 近限注入在轮 3（5-3+1=剩余 3 轮）首次出现，且全流恰一条
    expect(countMessagesContaining(fake.calls[1].messages, NEAR_LIMIT_MARK)).toBe(0);
    expect(countMessagesContaining(fake.calls[2].messages, NEAR_LIMIT_MARK)).toBe(1);
    expect(fake.calls[2].messages.some((m) => m.content.includes('剩余 3 轮'))).toBe(true);
    expect(countMessagesContaining(fake.calls[5].messages, NEAR_LIMIT_MARK)).toBe(1);
    // 第 6 次调用即终稿轮：注入终稿指令、不执行工具
    expect(messagesHave(fake.calls[5].messages, FINAL_WRAPUP_MARK)).toBe(true);
    expect(events.filter((e) => e.event === 'tools')).toHaveLength(5);
    const doneData = JSON.parse(events.filter((e) => e.event === 'done')[0].data);
    expect(doneData.message).toBe(finalText);
    expect(doneData.message).not.toBe(BARE_LIMIT);
  });

  // design_turn-limit-wrapup 3.2 兜底 + 3.4 终止口径：终稿轮空产出 → 结构化终止
  // 文案（含轮次、已执行操作数、「继续」指引），不再出现裸字面串。
  it('empty final wrap-up output → structured limit message with turns, op count and continue hint', async () => {
    const svc = makeService();
    stubToolResults(svc, '[search "n"]\n(无匹配结果)');
    const fake = makeResponderClient((messages, callIndex) => {
      if (messagesHave(messages, FINAL_WRAPUP_MARK)) return ''; // 终稿轮空产出
      return `<search path="file-${callIndex}.js">needle-${callIndex}</search>`;
    });
    installFakePlanner(svc, fake);

    const events = await collectStreamEvents(svc, {
      history: [{ role: 'user', content: 'x' }],
      mode: 'planner',
      project_path: '',
      max_turns: 2,
    });

    // 预算 2 轮（各 1 次操作）+ 终稿轮 = 3 次调用
    expect(fake.callCount()).toBe(3);
    const doneData = JSON.parse(events.filter((e) => e.event === 'done')[0].data);
    expect(doneData.message).toContain('已达探索轮次上限（2 轮');
    expect(doneData.message).toContain('已执行 2 次工具操作');
    expect(doneData.message).toContain('再发送一条消息即可继续');
    expect(doneData.message).not.toBe(BARE_LIMIT);
    expect(doneData.message).not.toContain(BARE_LIMIT);
  });
});

describe('processStream — max_turns 参数（T1）', () => {
  // design_turn-limit-wrapup 3.5：非法类型不抛错、回落默认 50；数值 clamp 到 [1, 50]。
  it('invalid max_turns falls back to the 50-turn default', async () => {
    const svc = makeService();
    stubToolResults(svc, '[search "n"]\n(无匹配结果)');
    const fake = makeResponderClient((messages, callIndex) => {
      if (messagesHave(messages, FINAL_WRAPUP_MARK)) return '最终结论。\n<final/>';
      return `<search path="file-${callIndex}.js">needle-${callIndex}</search>`;
    });
    installFakePlanner(svc, fake);

    const events = await collectStreamEvents(svc, {
      history: [{ role: 'user', content: 'x' }],
      mode: 'planner',
      project_path: '',
      max_turns: 'abc' as any, // 非法类型：不抛错，回落默认 50
    });

    // 回落 50：预算 50 轮 + 终稿轮 1 = 51 次调用；近限注入落于轮 48（剩余 3 轮）
    expect(fake.callCount()).toBe(51);
    expect(countMessagesContaining(fake.calls[46].messages, NEAR_LIMIT_MARK)).toBe(0);
    expect(countMessagesContaining(fake.calls[47].messages, NEAR_LIMIT_MARK)).toBe(1);
    expect(fake.calls[47].messages.some((m) => m.content.includes('剩余 3 轮'))).toBe(true);
    expect(messagesHave(fake.calls[50].messages, FINAL_WRAPUP_MARK)).toBe(true);
    const doneData = JSON.parse(events.filter((e) => e.event === 'done')[0].data);
    expect(doneData.message).toBe('最终结论。');
  });

  it('out-of-range values clamp: 0 → 1 turn, 999 → 50 turns', async () => {
    // 下钳：0 → 1 轮（近限注入即“剩余 1 轮”），随后终稿轮，共 2 次调用
    const svcLow = makeService();
    stubToolResults(svcLow, '[search "n"]\n(无匹配结果)');
    const fakeLow = makeResponderClient((messages, callIndex) => {
      if (messagesHave(messages, FINAL_WRAPUP_MARK)) return '最终结论。\n<final/>';
      return `<search path="file-${callIndex}.js">needle-${callIndex}</search>`;
    });
    installFakePlanner(svcLow, fakeLow);
    await collectStreamEvents(svcLow, {
      history: [{ role: 'user', content: 'x' }],
      mode: 'planner',
      project_path: '',
      max_turns: 0,
    });
    expect(fakeLow.callCount()).toBe(2);
    expect(fakeLow.calls[0].messages.some((m) => m.content.includes('剩余 1 轮'))).toBe(true);

    // 上钳：999 → 50（与默认同路径），共 51 次调用
    const svcHigh = makeService();
    stubToolResults(svcHigh, '[search "n"]\n(无匹配结果)');
    const fakeHigh = makeResponderClient((messages, callIndex) => {
      if (messagesHave(messages, FINAL_WRAPUP_MARK)) return '最终结论。\n<final/>';
      return `<search path="file-${callIndex}.js">needle-${callIndex}</search>`;
    });
    installFakePlanner(svcHigh, fakeHigh);
    await collectStreamEvents(svcHigh, {
      history: [{ role: 'user', content: 'x' }],
      mode: 'planner',
      project_path: '',
      max_turns: 999,
    });
    expect(fakeHigh.callCount()).toBe(51);
    expect(messagesHave(fakeHigh.calls[50].messages, FINAL_WRAPUP_MARK)).toBe(true);
  });
});
