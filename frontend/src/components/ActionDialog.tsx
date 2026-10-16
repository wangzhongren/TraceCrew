/**
 * 动作配置与共享协议标签清洗。
 * 模块名 ActionDialog 为历史沿用：原默认导出的 ActionDialog 死组件
 * （零引用）已随「定位对齐」变更移除，本文件现仅保留共享导出：
 *  - ActionType / ACTION_CONFIGS / getActionConfig / getActionsForNode（动作面）
 *  - cleanProtocolTags（ChatPanel / PlanCard / ReviewCard / ActionPanel 共用）
 * ACTION_CONFIGS 另由 MapperView（图谱视图）消费。
 */

/** 动作收敛（定位对齐）：本工具专精代码讲解，动作面仅保留只读的「解释」。 */
export type ActionType = 'explain';

interface ActionConfig {
  type: ActionType;
  label: string;
  icon: string;
  color: string;
  description: string;
}

export const ACTION_CONFIGS: Record<ActionType, ActionConfig> = {
  explain: {
    type: 'explain',
    label: '解释',
    icon: '',
    color: '#6b5b95',
    description: '生成详细的 Markdown 文档，解释选中节点的逻辑、调用关系和数据流',
  },
};

export function getActionConfig(action: ActionType, t: (key: string) => string) {
  const base = ACTION_CONFIGS[action];
  const labels: Record<ActionType, string> = {
    explain: t('action.explain'),
  };
  const descs: Record<ActionType, string> = {
    explain: t('action.explainDesc'),
  };
  return { ...base, label: labels[action], description: descs[action] };
}

/**
 * Return available actions for a given node status.
 * 动作收敛后所有节点状态一律仅提供「解释」；status 参数保留以稳定调用方签名
 * （MapperView 仍按节点状态调用）。
 */
export function getActionsForNode(_status: string): ActionType[] {
  return ['explain'];
}

/* ── Shared protocol-tag cleaner（F3：4 个 Agent 面板共用的唯一清洗实现）── */

/** 操作标签名：成对块与自闭合形态都要被整体剔除（连内容）。 */
const OPERATION_TAG_NAMES = 'list-dir|read-file|run-shell|update|create-file|delete-file|search';

/** 已知协议标签名全集：操作标签 + 终态/交接标记 + 保留内容的容器标签。 */
const PROTOCOL_TAG_NAMES = `${OPERATION_TAG_NAMES}|final|done|handoff-to-planner|handoff-to-architect|handoff-to-mapper|skip-architect|step-done|all-done|confirmed-requirement`;

/**
 * 清洗 Agent 流式文本里的协议标签，供 ChatPanel / PlanCard / ReviewCard /
 * ActionPanel 在渲染期统一调用（F3 单点维护）。规则分四类：
 *  1. 操作标签（list-dir 等）：成对块连内容一起剔除；自闭合形态直接剔除；
 *  2. 保留内容的容器标签（confirmed-requirement）：仅去掉开闭标签、保留内部文本；
 *  3. 自闭合终态/协议标记（final / done / handoff-to-planner / handoff-to-architect /
 *     handoff-to-mapper / skip-architect /
 *     step-done / all-done）：直接移除；成对的 done / step-done / all-done 连内容剔除；
 *  4. 未闭合的已知标签片段（只有开片段、无闭合）：按标签名精确匹配、行内剥离，
 *     普通文本与合法 HTML（如 <b>、<dataFile>）不受影响。
 * 最后压缩连续空行并去掉首尾空白。
 */
export function cleanProtocolTags(text: string): string {
  if (!text) return '';
  const operationSelfClosing = new RegExp(`<(${OPERATION_TAG_NAMES})\\b[^>]*\\/>`, 'gi');
  const operationPaired = new RegExp(`<(${OPERATION_TAG_NAMES})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, 'gi');
  const knownTagSweep = new RegExp(`<\\/?(?:${PROTOCOL_TAG_NAMES})\\b[^>]*>`, 'gi');
  const truncatedFragment = new RegExp(`<(?:${PROTOCOL_TAG_NAMES})\\b[^>\\n]*\\s*$`, 'i');
  return text
    .replace(operationSelfClosing, '')
    .replace(operationPaired, '')
    .replace(/<done\b[^>]*>[\s\S]*?<\/done\s*>/gi, '')
    .replace(/<step-done\b[^>]*>[\s\S]*?<\/step-done\s*>/gi, '')
    .replace(/<all-done\b[^>]*>[\s\S]*?<\/all-done\s*>/gi, '')
    .replace(/<\/?confirmed-requirement\b[^>]*>/gi, '')
    .replace(knownTagSweep, '')
    .replace(truncatedFragment, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
