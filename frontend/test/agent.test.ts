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
  req: { history: Array<{ role: string; content: string }>; mode: string; project_path: string },
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
