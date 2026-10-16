/* ═══════════════════════════════════════════════════════════
   Shared design constants — single source of truth
   for colors, icons, and labels across all components.
   Blueprint（蓝图室）light precision theme —— 冷纸白 + 墨蓝 + 制图红（保留色）
   ═══════════════════════════════════════════════════════════ */

export type NodeStatus = 'existing' | 'problem' | 'planned_change' | 'planned_new' | 'done'; // planned_change kept for backward compat, prefer problem

/* ── Sub-component (for planned_new nodes: composition of widgets/services) ── */

export interface SubComponent {
  id: string;
  label: string;
  category: 'widget' | 'service' | 'model' | 'hook' | 'util' | 'layout';
  widget_type?: string;   // e.g. "Button", "Form", "Table" when category='widget'
  props?: string;         // key props/params hint
  status?: NodeStatus;    // defaults to parent status
}

/* ── Impact scope (for problem nodes: what's affected by the bug) ── */

export interface ImpactScope {
  root_cause: string;           // which logic/line caused the bug
  trigger_path: string[];       // node IDs on the trigger path (upstream → bug node)
  affected_nodes: string[];     // downstream node IDs affected by the bug
  fix_files: string[];          // all files that need modification
  verification?: string;        // how to verify the fix
}

/* ── Multi-property status colors (for SVG rendering, MapCanvas) ── */

export interface StatusColor {
  fill: string;
  stroke: string;
  badge: string;
  text: string;
  icon: string;
}

export const STATUS_COLORS: Record<NodeStatus, StatusColor> = {
  existing:       { fill: '#ffffff', stroke: 'var(--color-status-existing)', badge: '#5e7089', text: '#3f4f6b', icon: '◈' },
  problem:        { fill: '#ffffff', stroke: 'var(--color-status-problem)', badge: '#c2452e', text: '#a83a26', icon: '✕' },
  planned_change: { fill: '#ffffff', stroke: 'var(--color-status-change)', badge: '#a97b2a', text: '#8f6720', icon: '✎' },
  planned_new:    { fill: '#ffffff', stroke: 'var(--color-status-new)', badge: '#2f7d5f', text: '#26644b', icon: '+' },
  done:           { fill: '#ffffff', stroke: 'var(--color-status-done)', badge: '#35608f', text: '#2b4f78', icon: '✓' },
};

export const STATUS_COLOR_DIM: StatusColor = {
  fill: '#f6f8fb', stroke: '#dbe2ec', badge: '#dbe2ec', text: '#a7b3c6', icon: '⬡',
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
  existing: '#7c8aa3',
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
  module:   { fill: '#eef2f8', stroke: '#35608f', text: '#2b4f78', dot: '#35608f' },
  class:    { fill: '#edf5f1', stroke: '#2f7d5f', text: '#26644b', dot: '#2f7d5f' },
  function: { fill: '#f7f2e7', stroke: '#a97b2a', text: '#8f6720', dot: '#a97b2a' },
};

/* ── Topology edge type colors ── */

export const TOPOLOGY_EDGE_COLORS: Record<string, string> = {
  call: '#a97b2a',
  inherit: '#2f7d5f',
  depend: '#35608f',
};

/* ── Bug impact zone colors (for MapCanvas rendering) ── */

export const BUG_IMPACT_COLORS = {
  triggerEdge: '#c2452e',        // red — trigger path edge
  triggerEdgeWidth: 2.5,         // thicker than default
  affectedBorder: '#a97b2a',     // orange — affected node border
  affectedDash: '6 3',           // dashed for affected nodes
  affectedBg: '#f8f4ea',         // warm-yellow bg tint for affected nodes
  rootCauseBadge: '#c2452e',     // red badge for root cause
} as const;

export const FEATURE_PANEL_COLORS = {
  surface: '#ffffff',
  surfaceVariant: '#f6f8fb',
  onSurface: '#1b2a44',
  onSurfaceVariant: '#51617e',
  outline: '#dbe2ec',
  outlineSoft: '#e9eef4',
  primary: '#35608f',
  green: '#2f7d5f',
  yellow: '#a97b2a',
} as const;

export const FEATURE_LEVEL_COLORS: Record<number, string> = {
  1: '#35608f',
  2: '#2f7d5f',
  3: '#a97b2a',
};
