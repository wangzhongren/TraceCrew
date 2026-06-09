/* ═══════════════════════════════════════════════════════════
   Shared design constants — single source of truth
   for colors, icons, and labels across all components.
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
  existing:       { fill: '#0f1923', stroke: 'var(--color-status-existing)', badge: 'var(--color-status-existing)', text: '#b8d4f8', icon: '◈' },
  problem:        { fill: '#2a1015', stroke: 'var(--color-status-problem)', badge: 'var(--color-status-problem)', text: '#fcc5c5', icon: '✕' },
  planned_change: { fill: '#1f1a08', stroke: 'var(--color-status-change)', badge: 'var(--color-status-change)', text: '#fae8a0', icon: '✎' },
  planned_new:    { fill: '#0a1f12', stroke: 'var(--color-status-new)', badge: 'var(--color-status-new)', text: '#a0f0c0', icon: '+' },
  done:           { fill: '#0a1f12', stroke: 'var(--color-status-done)', badge: 'var(--color-status-done)', text: '#a0f0c0', icon: '✓' },
};

export const STATUS_COLOR_DIM: StatusColor = {
  fill: '#0a0d10', stroke: '#1a2a3a', badge: '#1a2a3a', text: '#3a4a5a', icon: '⬡',
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

/* ── Edge colors ── */

export const EDGE_COLORS: Record<string, string> = {
  existing: '#3a5a8c',
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
  module:   { fill: '#1e2535', stroke: '#8ab4f8', text: '#d6e3ff', dot: '#8ab4f8' },
  class:    { fill: '#1b2a1e', stroke: '#b4d7a8', text: '#cce8c7', dot: '#b4d7a8' },
  function: { fill: '#262016', stroke: '#fdd663', text: '#fce8b2', dot: '#fdd663' },
};

/* ── Topology edge type colors ── */

export const TOPOLOGY_EDGE_COLORS: Record<string, string> = {
  call: '#fdd663',
  inherit: '#b4d7a8',
  depend: '#8ab4f8',
};

/* ── Feature panel colors ── */

export const FEATURE_PANEL_COLORS = {
  surface: '#1a1c1e',
  surfaceVariant: '#282a2d',
  onSurface: '#e3e2e6',
  onSurfaceVariant: '#c4c7c5',
  outline: '#444746',
  outlineSoft: '#303234',
  primary: '#8ab4f8',
  green: '#3fb950',
  yellow: '#d29922',
} as const;

export const FEATURE_LEVEL_COLORS: Record<number, string> = {
  1: '#8ab4f8',
  2: '#3fb950',
  3: '#d29922',
};
