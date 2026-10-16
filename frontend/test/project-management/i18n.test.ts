/**
 * O-b1 i18n 一致性测试（2026-10-16 批 1 提案，客户批准）：
 * 1. 4 个语言包键集合完全一致（防止漏译或漏删）；
 * 2. 关键键（流水线文案、6 个 Agent 设置、5 个动作标签）在每个语言包中存在；
 * 3. 流水线文案与实现一致（含 Architect）。
 */
import { describe, it, expect } from 'vitest';
import zhCN from '../../src/i18n/zh-CN.json';
import en from '../../src/i18n/en.json';
import ja from '../../src/i18n/ja.json';
import ko from '../../src/i18n/ko.json';

const LOCALES: Record<string, Record<string, string>> = {
  'zh-CN': zhCN,
  en,
  ja,
  ko,
};

describe('i18n 语言包一致性', () => {
  it('4 个语言包键集合完全一致', () => {
    const reference = Object.keys(zhCN).sort();
    for (const name of Object.keys(LOCALES)) {
      const keys = Object.keys(LOCALES[name]).sort();
      expect(keys, `语言包 ${name} 的键集合应与 zh-CN 一致`).toEqual(reference);
    }
  });

  it('关键键在每个语言包中都存在', () => {
    const criticalKeys = [
      'chat.pipelineFlow',
      'settings.agentPm',
      'settings.agentArchitect',
      'settings.agentPlanner',
      'settings.agentReviewer',
      'settings.agentMapper',
      'settings.agentExecutor',
      'action.explain',
      'action.explainDesc',
      'action.explainPlaceholder',
    ];
    for (const name of Object.keys(LOCALES)) {
      for (const key of criticalKeys) {
        expect(typeof LOCALES[name][key], `语言包 ${name} 缺少关键键 ${key}`).toBe('string');
      }
    }
  });

  it('chat.pipelineFlow 与实现一致（包含 Architect）', () => {
    for (const name of Object.keys(LOCALES)) {
      const flow = LOCALES[name]['chat.pipelineFlow'];
      expect(flow, `${name}.chat.pipelineFlow 应包含 Architect`).toContain('Architect');
      expect(flow).toContain('Planner');
      expect(flow).toContain('Mapper');
    }
  });
});
