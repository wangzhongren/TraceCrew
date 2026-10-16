/**
 * O-b1（批 2 / D3，调度节点 B2-6；提案 §3 与 §8）：自 App.tsx 抽取到
 * `src/hooks/useAutoExec.ts` 的两个可测纯函数的单测——
 * topoSortNodes（一键执行的拓扑排序；两端不全在节点集内的边不计依赖）与
 * collectAffectedExistingIds（impact_scope.affected_nodes ∩ status=existing）。
 * 抽取为纯搬运，此处锁定抽取时刻的既有行为。
 */
import { describe, it, expect } from 'vitest';
import { topoSortNodes, collectAffectedExistingIds } from '../../src/hooks/useAutoExec';
import type { CallGraph, GraphNode } from '../../src/types/graph';

/** 最小 GraphNode 构造器：默认 planned_new、无 impact_scope，用例按需覆盖 */
function makeNode(id: string, over: Partial<GraphNode> = {}): GraphNode {
  return { id, label: id, kind: 'module', status: 'planned_new', detail: '', ...over };
}

describe('topoSortNodes', () => {
  it('orders a linear chain by dependency direction regardless of input order', () => {
    const a = makeNode('a');
    const b = makeNode('b');
    const c = makeNode('c');

    const sorted = topoSortNodes([c, b, a], [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ]);

    expect(sorted.map(n => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('ignores edges whose endpoints are outside the current node set', () => {
    const a = makeNode('a');
    const b = makeNode('b');

    const sorted = topoSortNodes([a, b], [
      { from: 'a', to: 'ghost' },
      { from: 'ghost', to: 'b' },
    ]);

    // 两条边都因端点不在节点集内被忽略 → 两节点入度均为 0，保持输入顺序
    expect(sorted.map(n => n.id)).toEqual(['a', 'b']);
  });

  it('omits nodes that take part only in a dependency cycle', () => {
    const a = makeNode('a');
    const b = makeNode('b');

    const sorted = topoSortNodes([a, b], [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
    ]);

    expect(sorted).toEqual([]);
  });
});

describe('collectAffectedExistingIds', () => {
  it('keeps only affected ids that resolve to status=existing, deduplicated', () => {
    const graph: CallGraph = {
      nodes: [
        makeNode('bug-a', {
          status: 'problem',
          impact_scope: { root_cause: 'r', trigger_path: [], affected_nodes: ['mod-a', 'mod-b', 'ghost'], fix_files: [] },
        }),
        makeNode('bug-b', {
          status: 'problem',
          impact_scope: { root_cause: 'r', trigger_path: [], affected_nodes: ['mod-a', 'new-c'], fix_files: [] },
        }),
        makeNode('mod-a', { status: 'existing' }),
        makeNode('mod-b', { status: 'planned_change' }),
        makeNode('new-c', { status: 'planned_new' }),
      ],
      edges: [],
    };

    // mod-a 出现两次 → Set 去重；mod-b 非 existing；ghost 不存在；new-c 非 existing
    expect([...collectAffectedExistingIds(graph)]).toEqual(['mod-a']);
  });

  it('returns an empty set when no node declares an impact scope', () => {
    const graph: CallGraph = {
      nodes: [makeNode('mod-a', { status: 'existing' })],
      edges: [],
    };

    expect(collectAffectedExistingIds(graph).size).toBe(0);
  });
});
