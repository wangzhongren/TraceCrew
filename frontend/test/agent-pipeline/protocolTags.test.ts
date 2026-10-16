/**
 * F3 / O-F3（2026-10-16，修复提案 docs/fix/2026-10-16_fix-e2e-findings.md §3、§9）：
 * 共享协议标签清洗工具 `cleanProtocolTags`（定义于 ActionDialog.tsx，5 个组件共用）
 * 的分类规则单测。第 9、10 组用 E2E 真实链路留档
 * （/tmp/tracecrew-e2e/evidence/）中的 done.message 样例做回归：
 *   - t1-planner-search（attempt1/2/3）：整条响应只剩操作标签；
 *   - t2a-pm-turn1 / t2a-pm-turn2：正文与 <confirmed-requirement> 内容保留，
 *     协议标签（<done/>、<final/> 等）全部移除。
 */
import { describe, it, expect } from 'vitest';
import { cleanProtocolTags } from '../../src/components/ActionDialog';

describe('cleanProtocolTags', () => {
  it('removes operation paired blocks together with their content (all 7 tag names)', () => {
    const input = [
      '分析完成。',
      '<list-dir path="src/"></list-dir>',
      '<read-file path="src/server.js"></read-file>',
      '<search path="src/" regex="true">(req\\.|res\\.|http)</search>',
      '<run-shell cmd="npm test"></run-shell>',
      '<update path="a.js">新内容</update>',
      '<create-file path="b.js">文件正文</create-file>',
      '<delete-file path="c.js"></delete-file>',
      '以下是结论。',
    ].join('\n');

    expect(cleanProtocolTags(input)).toBe('分析完成。\n\n以下是结论。');
  });

  it('removes self-closing operation tags', () => {
    const input = 'A\n<read-file path="README.md" />\n<list-dir path="."/>\nB';

    expect(cleanProtocolTags(input)).toBe('A\n\nB');
  });

  it('strips only the confirmed-requirement container tags and keeps the inner text', () => {
    const input = '整理如下：\n\n<confirmed-requirement>\n## 需求确认\n\n新增按标签筛选。\n</confirmed-requirement>\n\n以上。';

    expect(cleanProtocolTags(input))
      .toBe('整理如下：\n\n## 需求确认\n\n新增按标签筛选。\n\n以上。');
  });

  it('removes self-closing terminal and handoff protocol markers', () => {
    expect(cleanProtocolTags('答复如下：\n\n<final/>')).toBe('答复如下：');
    expect(cleanProtocolTags('问题一？\n<done/>')).toBe('问题一？');
    expect(cleanProtocolTags('需求已明确。\n<handoff-to-planner/>')).toBe('需求已明确。');
    expect(cleanProtocolTags('小需求，跳过架构。\n<skip-architect/>')).toBe('小需求，跳过架构。');
  });

  it('removes paired done / step-done / all-done blocks together with their content', () => {
    const done = '开始\n<done>完成摘要</done>\n结束';
    const stepDone = 'A\n<step-done step="2">第 2 步完成</step-done>\nB';
    const allDone = 'A\n<all-done>全部完成</all-done>\nB';

    expect(cleanProtocolTags(done)).toBe('开始\n\n结束');
    expect(cleanProtocolTags(stepDone)).toBe('A\n\nB');
    expect(cleanProtocolTags(allDone)).toBe('A\n\nB');
  });

  it('strips unclosed opening / closing fragments of known tags inline', () => {
    // 只有开片段、无闭合：只去掉标签本身，前后正文保留
    expect(cleanProtocolTags('先看这段 <read-file path="src/x.js"> 然后继续'))
      .toBe('先看这段  然后继续');
    // 只有闭合片段：同样只去标签
    expect(cleanProtocolTags('内容 </read-file> 继续')).toBe('内容  继续');
  });

  it('strips a truncated unterminated fragment at the end of the text', () => {
    expect(cleanProtocolTags('我先读一下 <read-file path="src/serv')).toBe('我先读一下');
    expect(cleanProtocolTags('分析中 <search path="src/\n')).toBe('分析中');
    expect(cleanProtocolTags('也许 <do')).toBe('也许 <do');
  });

  it('leaves clean text and non-protocol markup untouched, and is idempotent', () => {
    const clean = '# 标题\n\n正文内容，没有协议标签。';
    expect(cleanProtocolTags(clean)).toBe(clean);

    const nonProtocol = '公式 a < b；<b>粗体</b>、<dataFile>、<pid>、'
      + '<YYYYMMDD-HHmmss>、<Date.now()>、<updated>、<list-directory>';
    expect(cleanProtocolTags(nonProtocol)).toBe(nonProtocol);

    const mixed = '开头\n<read-file path="x.js"></read-file>\n<done/>\n正文\n<final/>';
    const once = cleanProtocolTags(mixed);
    expect(cleanProtocolTags(once)).toBe(once);
  });

  it('E2E 留档回归：整条只含操作标签的响应清洗后为空串', () => {
    // t1-planner-search.summary.json
    const attempt1 = '<read-file path="README.md"></read-file>\n'
      + '<read-file path="package.json"></read-file>\n'
      + '<read-file path="src/server.js"></read-file>';
    // t1-planner-search-attempt2.summary.json
    const attempt2 = '<list-dir path="src/"></list-dir>\n'
      + '<read-file path="README.md"></read-file>\n'
      + '<read-file path="package.json"></read-file>';
    // t1-planner-search-attempt3.summary.json
    const attempt3 = '<search path="src/" regex="true">'
      + '(req\\.|res\\.|http|route|router|url|pathname|method)</search>';

    expect(cleanProtocolTags(attempt1)).toBe('');
    expect(cleanProtocolTags(attempt2)).toBe('');
    expect(cleanProtocolTags(attempt3)).toBe('');
  });

  it('E2E 留档回归：PM 轮次保留正文与已确认需求，协议标签零残留', () => {
    // t2a-pm-turn1.summary.json
    const turn1 = '<list-dir path="."></list-dir>\n\n我先了解一下项目结构，再和您确认需求细节。';
    expect(cleanProtocolTags(turn1)).toBe('我先了解一下项目结构，再和您确认需求细节。');

    // t2a-pm-turn2.summary.json 的等价摘录（read-file 块 + <done/> + <search> 块
    // + <confirmed-requirement> 容器 + <final/>）
    const turn2 = [
      '<read-file path="src/server.js"></read-file>',
      '',
      '我先看一下现有的路由和筛选逻辑，再向您确认几个关键点。',
      '',
      '<done/>',
      '',
      '（继续）请提出你的澄清问题。',
      '',
      '<search path="src/" regex="true">filter|筛选</search>',
      '',
      '筛选逻辑位置已确认。下方是按默认方案整理的需求确认：',
      '',
      '<confirmed-requirement>',
      '',
      '## 需求确认',
      '',
      '- 标签匹配采用 OR 语义',
      '',
      '</confirmed-requirement>',
      '',
      '若认可，我将交接架构师。',
      '',
      '<final/>',
    ].join('\n');

    const cleaned = cleanProtocolTags(turn2);
    expect(cleaned).toContain('我先看一下现有的路由和筛选逻辑');
    expect(cleaned).toContain('（继续）请提出你的澄清问题。');
    expect(cleaned).toContain('## 需求确认');
    expect(cleaned).toContain('标签匹配采用 OR 语义');
    expect(cleaned).toContain('若认可，我将交接架构师。');
    expect(cleaned).not.toMatch(
      /<\/?(?:list-dir|read-file|run-shell|update|create-file|delete-file|search|final|done|handoff-to-planner|skip-architect|step-done|all-done|confirmed-requirement)\b/i,
    );
  });
});
