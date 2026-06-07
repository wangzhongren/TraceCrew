/**
 * Unit tests for frontend/src/store/topologyStore.ts
 *
 * Tests Zustand state management for topology graph (nodes + edges).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useTopologyStore } from '../src/store/topologyStore';
import type { TopologyNode, TopologyEdge } from '../src/types/topology';

beforeEach(() => {
  useTopologyStore.setState({ nodes: [], edges: [] });
});

// ═══════════════════════════════════════════════════════════════════
// applyTopologyCommands
// ═══════════════════════════════════════════════════════════════════

describe('applyTopologyCommands — upsert_node', () => {
  it('adds a new node', () => {
    const store = useTopologyStore.getState();
    store.applyTopologyCommands([
      {
        action: 'upsert_node',
        node: { id: 'n1', label: 'AuthService', type: 'class', layer: 1 },
      },
    ]);

    expect(useTopologyStore.getState().nodes).toHaveLength(1);
    expect(useTopologyStore.getState().nodes[0].id).toBe('n1');
    expect(useTopologyStore.getState().nodes[0].label).toBe('AuthService');
  });

  it('updates an existing node (upsert)', () => {
    const store = useTopologyStore.getState();
    store.applyTopologyCommands([
      {
        action: 'upsert_node',
        node: { id: 'n1', label: 'Original', type: 'class', layer: 1 },
      },
    ]);

    store.applyTopologyCommands([
      {
        action: 'upsert_node',
        node: { id: 'n1', label: 'Updated', type: 'function', layer: 2, file: 'src/auth.ts' },
      },
    ]);

    const nodes = useTopologyStore.getState().nodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0].label).toBe('Updated');
    expect(nodes[0].type).toBe('function');
    expect(nodes[0].layer).toBe(2);
    expect(nodes[0].file).toBe('src/auth.ts');
  });

  it('ignores upsert with missing node', () => {
    useTopologyStore.getState().applyTopologyCommands([
      { action: 'upsert_node' },
    ]);
    expect(useTopologyStore.getState().nodes).toEqual([]);
  });
});

describe('applyTopologyCommands — delete_node', () => {
  it('removes a node and its connected edges', () => {
    const store = useTopologyStore.getState();
    store.applyTopologyCommands([
      { action: 'upsert_node', node: { id: 'n1', label: 'A', type: 'class', layer: 1 } },
      { action: 'upsert_node', node: { id: 'n2', label: 'B', type: 'class', layer: 2 } },
      { action: 'upsert_node', node: { id: 'n3', label: 'C', type: 'class', layer: 2 } },
      {
        action: 'add_edge',
        edge: { source: 'n1', target: 'n2', type: 'call' },
      },
      {
        action: 'add_edge',
        edge: { source: 'n2', target: 'n3', type: 'depend' },
      },
    ]);

    store.applyTopologyCommands([
      { action: 'delete_node', node: { id: 'n1' } },
    ]);

    const state = useTopologyStore.getState();
    expect(state.nodes).toHaveLength(2);
    expect(state.nodes.map((n) => n.id)).toEqual(['n2', 'n3']);

    // Only n2→n3 edge should remain (n1 edges removed)
    expect(state.edges).toHaveLength(1);
    expect(state.edges[0].source).toBe('n2');
    expect(state.edges[0].target).toBe('n3');
  });

  it('ignores delete with missing node', () => {
    useTopologyStore.getState().applyTopologyCommands([
      { action: 'upsert_node', node: { id: 'n1', label: 'A', type: 'class', layer: 1 } },
      { action: 'delete_node' },
    ]);
    expect(useTopologyStore.getState().nodes).toHaveLength(1);
  });
});

describe('applyTopologyCommands — add_edge', () => {
  it('adds an edge between nodes', () => {
    const store = useTopologyStore.getState();
    store.applyTopologyCommands([
      { action: 'upsert_node', node: { id: 'src', label: 'Src', type: 'module', layer: 1 } },
      { action: 'upsert_node', node: { id: 'tgt', label: 'Tgt', type: 'module', layer: 1 } },
      {
        action: 'add_edge',
        edge: { source: 'src', target: 'tgt', type: 'call' },
      },
    ]);

    const edges = useTopologyStore.getState().edges;
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe('src');
    expect(edges[0].target).toBe('tgt');
    expect(edges[0].type).toBe('call');
  });

  it('deduplicates edges (same source+target)', () => {
    const store = useTopologyStore.getState();
    store.applyTopologyCommands([
      { action: 'upsert_node', node: { id: 'a', label: 'A', type: 'class', layer: 1 } },
      { action: 'upsert_node', node: { id: 'b', label: 'B', type: 'class', layer: 2 } },
      { action: 'add_edge', edge: { source: 'a', target: 'b', type: 'call' } },
      { action: 'add_edge', edge: { source: 'a', target: 'b', type: 'inherit' } },
    ]);

    // Second edge with same source→target is not added
    expect(useTopologyStore.getState().edges).toHaveLength(1);
    expect(useTopologyStore.getState().edges[0].type).toBe('call');
  });

  it('ignores add_edge with missing edge object', () => {
    useTopologyStore.getState().applyTopologyCommands([
      { action: 'add_edge' },
    ]);
    expect(useTopologyStore.getState().edges).toEqual([]);
  });
});

describe('applyTopologyCommands — delete_edge', () => {
  it('removes an edge by source+target', () => {
    const store = useTopologyStore.getState();
    store.applyTopologyCommands([
      { action: 'upsert_node', node: { id: 'a', label: 'A', type: 'class', layer: 1 } },
      { action: 'upsert_node', node: { id: 'b', label: 'B', type: 'class', layer: 2 } },
      { action: 'add_edge', edge: { source: 'a', target: 'b', type: 'call' } },
      { action: 'add_edge', edge: { source: 'b', target: 'a', type: 'depend' } },
    ]);

    store.applyTopologyCommands([
      { action: 'delete_edge', edge: { source: 'a', target: 'b' } },
    ]);

    expect(useTopologyStore.getState().edges).toHaveLength(1);
    expect(useTopologyStore.getState().edges[0].source).toBe('b');
  });

  it('ignores delete_edge with missing edge object', () => {
    useTopologyStore.getState().applyTopologyCommands([
      { action: 'upsert_node', node: { id: 'a', label: 'A', type: 'class', layer: 1 } },
      { action: 'add_edge', edge: { source: 'a', target: 'b', type: 'call' } },
      { action: 'delete_edge' },
    ]);
    // Edge still exists
    expect(useTopologyStore.getState().edges).toHaveLength(1);
  });
});

describe('applyTopologyCommands — unknown action', () => {
  it('silently ignores unknown actions', () => {
    useTopologyStore.getState().applyTopologyCommands([
      { action: 'unknown_action', foo: 'bar' },
    ]);
    expect(useTopologyStore.getState().nodes).toEqual([]);
    expect(useTopologyStore.getState().edges).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// clearAll
// ═══════════════════════════════════════════════════════════════════

describe('clearAll', () => {
  it('removes all nodes and edges', () => {
    const store = useTopologyStore.getState();
    store.applyTopologyCommands([
      { action: 'upsert_node', node: { id: 'n1', label: 'A', type: 'class', layer: 1 } },
      { action: 'upsert_node', node: { id: 'n2', label: 'B', type: 'class', layer: 2 } },
      { action: 'add_edge', edge: { source: 'n1', target: 'n2', type: 'call' } },
    ]);

    store.clearAll();

    expect(useTopologyStore.getState().nodes).toEqual([]);
    expect(useTopologyStore.getState().edges).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// batch command handling
// ═══════════════════════════════════════════════════════════════════

describe('batch commands', () => {
  it('applies multiple commands in order', () => {
    const store = useTopologyStore.getState();
    store.applyTopologyCommands([
      // Add 3 nodes
      { action: 'upsert_node', node: { id: 'a', label: 'A', type: 'module', layer: 1 } },
      { action: 'upsert_node', node: { id: 'b', label: 'B', type: 'class', layer: 2 } },
      { action: 'upsert_node', node: { id: 'c', label: 'C', type: 'function', layer: 3 } },
      // Connect them
      { action: 'add_edge', edge: { source: 'a', target: 'b', type: 'depend' } },
      { action: 'add_edge', edge: { source: 'b', target: 'c', type: 'call' } },
      // Delete one
      { action: 'delete_node', node: { id: 'b' } },
    ]);

    const state = useTopologyStore.getState();
    // Node b was deleted, a and c remain
    expect(state.nodes).toHaveLength(2);
    expect(state.nodes.map((n) => n.id)).toEqual(['a', 'c']);
    // All edges involving b are gone
    expect(state.edges).toEqual([]);
  });
});
