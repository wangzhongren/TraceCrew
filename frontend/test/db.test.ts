/**
 * Unit tests for electron/server/services/db.ts
 *
 * Tests SQLite database operations with temporary databases.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  saveFeatures,
  loadFeatures,
  findFeature,
  updateFeatureChildren,
  updateFeatureOverview,
  pushChange,
  pullChanges,
  hasPendingChanges,
  getMeta,
  setMeta,
  closeDatabase,
  featureToRow,
  featureToDict,
} from '../../electron/server/services/db';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracecrew-db-test-'));
});

afterEach(() => {
  closeDatabase(tmpDir);
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ═══════════════════════════════════════════════════════════════════
// featureToDict / featureToRow
// ═══════════════════════════════════════════════════════════════════

describe('featureToDict', () => {
  it('converts a DB row to feature dict', () => {
    const row = {
      id: 'f1',
      label: 'Auth',
      level: 1,
      parent_id: null,
      description: 'Authentication module',
      flow_description: 'login → validate → session',
      files: '["src/auth.ts","src/login.ts"]',
      functions: '["login","logout"]',
      generated: 1,
      children_json: '[]',
    };

    const dict = featureToDict(row);
    expect(dict.id).toBe('f1');
    expect(dict.label).toBe('Auth');
    expect(dict.files).toEqual(['src/auth.ts', 'src/login.ts']);
    expect(dict.functions).toEqual(['login', 'logout']);
    expect(dict.generated).toBe(true);
    expect(dict.children).toEqual([]);
  });

  it('handles already-parsed arrays', () => {
    const row = {
      id: 'f2',
      label: 'UI',
      level: 1,
      parent_id: null,
      files: ['src/ui.tsx'],
      functions: ['render'],
      generated: 0,
      children_json: '[]',
    };

    const dict = featureToDict(row);
    expect(dict.files).toEqual(['src/ui.tsx']);
    expect(dict.generated).toBe(false);
  });

  it('handles pre-parsed children array', () => {
    const row = {
      id: 'f3',
      label: 'Parent',
      level: 1,
      parent_id: null,
      children: [
        { id: 'c1', label: 'Child', level: 2, parent_id: 'f3', children_json: '[]' },
      ],
    };

    const dict = featureToDict(row);
    expect(dict.children).toHaveLength(1);
    expect((dict.children as any[])[0].id).toBe('c1');
  });
});

describe('featureToRow', () => {
  it('converts a feature node dict to DB row', () => {
    const node = {
      id: 'f1',
      label: 'Auth',
      level: 1,
      parent_id: null,
      description: 'auth module',
      flow_description: 'flow',
      files: ['src/auth.ts'],
      functions: ['login'],
      generated: true,
      children: [
        {
          id: 'c1',
          label: 'Login Form',
          level: 2,
          parent_id: 'f1',
          description: 'login form',
          flow_description: '',
          files: [],
          functions: [],
          generated: false,
          children: [],
        },
      ],
    };

    const row = featureToRow(node);
    expect(row.id).toBe('f1');
    expect(row.label).toBe('Auth');
    expect(row.files).toBe('["src/auth.ts"]');
    expect(row.generated).toBe(1);
    expect(typeof row.children_json).toBe('string');

    const childrenJson = JSON.parse(row.children_json as string);
    expect(childrenJson).toHaveLength(1);
    expect(childrenJson[0].id).toBe('c1');
  });

  it('uses empty arrays for missing fields', () => {
    const node = {
      id: 'minimal',
      label: 'min',
      level: 1,
    };

    const row = featureToRow(node as any);
    expect(row.files).toBe('[]');
    expect(row.functions).toBe('[]');
    expect(row.generated).toBe(0);
    expect(row.children_json).toBe('[]');
  });
});

// ═══════════════════════════════════════════════════════════════════
// saveFeatures / loadFeatures
// ═══════════════════════════════════════════════════════════════════

describe('saveFeatures / loadFeatures', () => {
  it('saves and loads feature tree', () => {
    const features = [
      {
        id: 'root',
        label: 'Overview',
        level: 1,
        parent_id: null,
        description: 'Project overview',
        flow_description: 'flow desc',
        files: ['src/index.ts'],
        functions: ['main'],
        generated: true,
        children: [],
      },
    ];

    saveFeatures(tmpDir, features);
    const loaded = loadFeatures(tmpDir);

    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('root');
    expect(loaded[0].label).toBe('Overview');
    expect(loaded[0].files).toEqual(['src/index.ts']);
  });

  it('overwrites existing features on resave', () => {
    saveFeatures(tmpDir, [
      { id: 'f1', label: 'Old', level: 1, children: [] },
    ]);
    saveFeatures(tmpDir, [
      { id: 'f2', label: 'New', level: 1, children: [] },
    ]);
    const loaded = loadFeatures(tmpDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].label).toBe('New');
  });

  it('returns empty array for no features', () => {
    const loaded = loadFeatures(tmpDir);
    expect(loaded).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// findFeature
// ═══════════════════════════════════════════════════════════════════

describe('findFeature', () => {
  it('finds feature by id at root level', () => {
    saveFeatures(tmpDir, [
      { id: 'f1', label: 'Feature 1', level: 1, children: [] },
      { id: 'f2', label: 'Feature 2', level: 1, children: [] },
    ]);

    const found = findFeature(tmpDir, 'f2');
    expect(found).not.toBeNull();
    expect(found!.label).toBe('Feature 2');
  });

  it('finds feature nested in children', () => {
    saveFeatures(tmpDir, [
      {
        id: 'parent',
        label: 'Parent',
        level: 1,
        children: [
          {
            id: 'child',
            label: 'Child',
            level: 2,
            parent_id: 'parent',
            children: [],
          },
        ],
      },
    ]);

    const found = findFeature(tmpDir, 'child');
    expect(found).not.toBeNull();
    expect(found!.label).toBe('Child');
    expect(found!.parent_id).toBe('parent');
  });

  it('returns null for non-existent feature', () => {
    saveFeatures(tmpDir, [{ id: 'f1', label: 'Only', level: 1, children: [] }]);

    const found = findFeature(tmpDir, 'nonexistent');
    expect(found).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// updateFeatureChildren
// ═══════════════════════════════════════════════════════════════════

describe('updateFeatureChildren', () => {
  it('updates children_json and sets generated=1', () => {
    saveFeatures(tmpDir, [
      { id: 'root', label: 'Overview', level: 1, generated: false, children: [] },
    ]);

    const newChildren = [
      {
        id: 'child1',
        label: 'Auth',
        level: 2,
        parent_id: 'root',
        children: [],
      },
      {
        id: 'child2',
        label: 'Database',
        level: 2,
        parent_id: 'root',
        children: [],
      },
    ];

    updateFeatureChildren(tmpDir, 'root', newChildren);

    const found = findFeature(tmpDir, 'root');
    expect(found).not.toBeNull();
    expect(found!.generated).toBe(true);
    expect((found!.children as any[])).toHaveLength(2);
    expect((found!.children as any[])[0].id).toBe('child1');
    expect((found!.children as any[])[1].id).toBe('child2');
  });
});

// ═══════════════════════════════════════════════════════════════════
// updateFeatureOverview
// ═══════════════════════════════════════════════════════════════════

describe('updateFeatureOverview', () => {
  it('updates flow_description and issues_json', () => {
    saveFeatures(tmpDir, [
      { id: 'root', label: 'Overview', level: 1, flow_description: '', issues_json: '[]', children: [] },
    ]);

    updateFeatureOverview(tmpDir, 'root', 'New flow: A → B → C', '[{"severity":"warn","msg":"test"}]');

    const found = findFeature(tmpDir, 'root');
    expect(found?.flow_description).toBe('New flow: A → B → C');
  });
});

// ═══════════════════════════════════════════════════════════════════
// pushChange / pullChanges / hasPendingChanges
// ═══════════════════════════════════════════════════════════════════

describe('change queue', () => {
  it('pushes and pulls changes', () => {
    pushChange(tmpDir, 'Refactored auth module', ['src/auth.ts', 'src/login.ts']);
    pushChange(tmpDir, 'Added new component', ['src/Button.tsx']);

    const changes = pullChanges(tmpDir);
    expect(changes).toHaveLength(2);
    expect(changes[0].summary).toBe('Refactored auth module');
    expect(changes[0].files_changed).toEqual(['src/auth.ts', 'src/login.ts']);
    expect(changes[1].summary).toBe('Added new component');
  });

  it('marks pulled changes as processed', () => {
    pushChange(tmpDir, 'Test change', ['test.ts']);
    pullChanges(tmpDir); // first pull

    const secondPull = pullChanges(tmpDir);
    expect(secondPull).toEqual([]); // already processed
  });

  it('hasPendingChanges returns true when changes exist', () => {
    expect(hasPendingChanges(tmpDir)).toBe(false);

    pushChange(tmpDir, 'Test', ['a.ts']);
    expect(hasPendingChanges(tmpDir)).toBe(true);

    pullChanges(tmpDir);
    expect(hasPendingChanges(tmpDir)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// getMeta / setMeta
// ═══════════════════════════════════════════════════════════════════

describe('meta store', () => {
  it('sets and gets meta values', () => {
    setMeta(tmpDir, 'last_analysis', '2024-06-01T00:00:00Z');
    const value = getMeta(tmpDir, 'last_analysis');
    expect(value).toBe('2024-06-01T00:00:00Z');
  });

  it('returns null for non-existent key', () => {
    const value = getMeta(tmpDir, 'nonexistent');
    expect(value).toBeNull();
  });

  it('overwrites existing value', () => {
    setMeta(tmpDir, 'key', 'value1');
    setMeta(tmpDir, 'key', 'value2');
    expect(getMeta(tmpDir, 'key')).toBe('value2');
  });

  it('scopes keys per project path', () => {
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'tracecrew-db-test-2-'));

    setMeta(tmpDir, 'key', 'project1-value');
    setMeta(tmpDir2, 'key', 'project2-value');

    expect(getMeta(tmpDir, 'key')).toBe('project1-value');
    expect(getMeta(tmpDir2, 'key')).toBe('project2-value');

    closeDatabase(tmpDir2);
    fs.rmSync(tmpDir2, { recursive: true, force: true });
  });
});
