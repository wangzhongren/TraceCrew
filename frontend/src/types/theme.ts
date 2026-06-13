/* ═══════════════════════════════════════════════════════════
   Shared design constants — single source of truth
   for colors, icons, and labels across all components.
   Light minimal industrial theme.
   ═══════════════════════════════════════════════════════════ */

export type NodeStatus = 'existing' | 'problem' | 'planned_change' | 'planned_new' | 'done'; // planned_change kept for backward compat, prefer problem

/* ── Multi-property status colors (for SVG rendering, MapCanvas) ── */

export interface StatusColor {
  fill: string;
  stroke: string;
  badge: string;
  text: string;
  icon: string;
}

export const STATUS_COLORS: Record<NodeStatus, StatusColor> = {
  existing:       { fill: '#ffffff', stroke: 'var(--color-status-existing)', badge: '#6b7280', text: '#374151', icon: '◈' },
  problem:        { fill: '#ffffff', stroke: 'var(--color-status-problem)', badge: '#dc2626', text: '#991b1b', icon: '✕' },
  planned_change: { fill: '#ffffff', stroke: 'var(--color-status-change)', badge: '#d97706', text: '#92400e', icon: '✎' },
  planned_new:    { fill: '#ffffff', stroke: 'var(--color-status-new)', badge: '#16a34a', text: '#166534', icon: '+' },
  done:           { fill: '#ffffff', stroke: 'var(--color-status-done)', badge: '#16a34a', text: '#166534', icon: '✓' },
};

export const STATUS_COLOR_DIM: StatusColor = {
  fill: '#f9fafb', stroke: '#d0d5dd', badge: '#d0d5dd', text: '#9ca3af', icon: '⬡',
};

/* ── Single-color status (for simple badges, MapperView, etc.) ── */

export const STATUS_COLORS_SIMPLE: Record<NodeStatus, string> = {
  existing: 'var(--color-status-existing)',
  problem: 'var(--color-status-problem)',
  planned_change: 'var(--color-status-change)',
  planned_new: 'var(--color-status-new)',
  done: 'var(--color-status-done)',
};

/* ── Status icons & labels ── */

export const STATUS_ICONS: Record<string, string> = {
  existing: '◈', problem: '✕', planned_change: '✎', planned_new: '+', done: '✓',
};

export const STATUS_LABELS: Record<string, string> = {
  existing: '现有', problem: '问题', planned_change: '待改', planned_new: '新增', done: '完成',
};

export function getStatusLabels(t: (key: string) => string): Record<string, string> {
  return {
    existing: t('status.existing'),
    problem: t('status.problem'),
    planned_change: t('status.toChange'),
    planned_new: t('status.new'),
    done: t('status.done'),
  };
}

/* ── Edge colors ── */

export const EDGE_COLORS: Record<string, string> = {
  existing: '#9ca3af',
  new: 'var(--color-status-new)',
  removed: 'var(--color-status-problem)',
  error: 'var(--color-status-problem)',
};

/* ── Topology node type colors ── */

export interface NodeTypeColor {
  fill: string;
  stroke: string;
  text: string;
  dot: string;
}

export const NODE_TYPE_COLORS: Record<string, NodeTypeColor> = {
  module:   { fill: '#eff6ff', stroke: '#3b82f6', text: '#1e40af', dot: '#3b82f6' },
  class:    { fill: '#f0fdf4', stroke: '#16a34a', text: '#166534', dot: '#16a34a' },
  function: { fill: '#fffbeb', stroke: '#d97706', text: '#92400e', dot: '#d97706' },
};

/* ── Topology edge type colors ── */

export const TOPOLOGY_EDGE_COLORS: Record<string, string> = {
  call: '#d97706',
  inherit: '#16a34a',
  depend: '#3b82f6',
};

/* ── Feature panel colors ── */

export const FEATURE_PANEL_COLORS = {
  surface: '#ffffff',
  surfaceVariant: '#f7f8fa',
  onSurface: '#1a1a2e',
  onSurfaceVariant: '#4a5568',
  outline: '#d0d5dd',
  outlineSoft: '#e5e7eb',
  primary: '#3b82f6',
  green: '#16a34a',
  yellow: '#ca8a04',
} as const;

export const FEATURE_LEVEL_COLORS: Record<number, string> = {
  1: '#3b82f6',
  2: '#16a34a',
  3: '#ca8a04',
};
