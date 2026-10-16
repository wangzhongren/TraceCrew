/**
 * O1 等价覆盖（2026-10-16 提案 docs/fix/2026-10-16_fix_test-suite-red.md 第 7 节）：
 * `ChatPanel.agentLoop` 的「ctx + systemPrompt + 可选项目文件树 → user 消息 content」
 * 拼装已抽为模块级导出纯函数 `buildAgentUserContent`（拼接格式逐字不变）；
 * `window.tracecrew.file.listDirectory` 的 IPC 调用留在调用点，纯函数只接收已获取的数据。
 */
import { describe, it, expect } from 'vitest';
import { buildAgentUserContent } from '../../src/components/ChatPanel';

describe('buildAgentUserContent', () => {
  it('produces the full format with the file tree section when a tree is provided', () => {
    const tree = [{ name: 'src', type: 'directory', children: [] }];
    const content = buildAgentUserContent('CTX', 'SYS', tree);
    const expected = `CTX\n\nSYS\n\n【项目文件树】\n${JSON.stringify(tree, null, 2)}`;
    expect(content).toBe(expected);
    expect(content).toContain('【项目文件树】');
  });

  it('truncates the file tree JSON at 2000 characters', () => {
    const bigTree = [{ name: 'x'.repeat(4000) }];
    const prefix = 'CTX\n\nSYS\n\n【项目文件树】\n';
    const fullJson = JSON.stringify(bigTree, null, 2);
    expect(fullJson.length).toBeGreaterThan(2000);

    const content = buildAgentUserContent('CTX', 'SYS', bigTree);
    const json = content.slice(prefix.length);
    expect(json).toHaveLength(2000);
    expect(json).toBe(fullJson.slice(0, 2000));
  });

  it('degrades to ctx + blank line + systemPrompt when no file tree is available', () => {
    expect(buildAgentUserContent('CTX', 'SYS', null)).toBe('CTX\n\nSYS');
    expect(buildAgentUserContent('CTX', 'SYS', undefined)).toBe('CTX\n\nSYS');
    expect(buildAgentUserContent('CTX', 'SYS', null)).not.toContain('【项目文件树】');
  });

  it('keeps ctx before systemPrompt separated by exactly one blank line', () => {
    const ctx = '第一段：上下文';
    const systemPrompt = '第二段：系统提示';
    const content = buildAgentUserContent(ctx, systemPrompt, [{ name: 'a.ts' }]);
    expect(content.indexOf(ctx)).toBe(0);
    expect(content.indexOf(systemPrompt)).toBe(ctx.length + 2); // ctx 之后是 '\n\n'
    expect(content.indexOf('【项目文件树】')).toBe(ctx.length + 2 + systemPrompt.length + 2);
  });
});
