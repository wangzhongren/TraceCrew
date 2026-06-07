import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

const DB_FILENAME = 'codeatlas.db';

// Cache open databases by project path
const dbCache = new Map<string, Database.Database>();

function connect(projectPath: string): Database.Database {
  let db = dbCache.get(projectPath);
  if (db) return db;

  const storeDir = path.join(projectPath, '.codeatlas');
  fs.mkdirSync(storeDir, { recursive: true });
  const dbPath = path.join(storeDir, DB_FILENAME);

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initTables(db);
  dbCache.set(projectPath, db);
  return db;
}

export function closeDatabase(projectPath: string): void {
  const db = dbCache.get(projectPath);
  if (db) {
    db.close();
    dbCache.delete(projectPath);
  }
}

function initTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS features (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      label TEXT NOT NULL,
      level INTEGER DEFAULT 1,
      parent_id TEXT,
      description TEXT DEFAULT '',
      flow_description TEXT DEFAULT '',
      files TEXT DEFAULT '[]',
      functions TEXT DEFAULT '[]',
      generated INTEGER DEFAULT 0,
      children_json TEXT DEFAULT '[]',
      issues_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_features_parent ON features(parent_id);
    CREATE INDEX IF NOT EXISTS idx_features_project ON features(project_path);
  `);

  // Migration: add issues_json column
  try {
    db.exec("ALTER TABLE features ADD COLUMN issues_json TEXT DEFAULT '[]'");
  } catch { /* column already exists */ }

  db.exec(`
    CREATE TABLE IF NOT EXISTS change_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT NOT NULL,
      summary TEXT DEFAULT '',
      files_changed TEXT DEFAULT '[]',
      processed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_queue_project ON change_queue(project_path, processed);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT ''
    );
  `);
}

/* ── JSON helpers ── */

function toJson(val: unknown): string {
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

function parseJsonField(val: unknown): unknown[] {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return []; }
  }
  return [];
}

/* ── Feature CRUD ── */

export function featureToRow(node: Record<string, unknown>): Record<string, unknown> {
  const children = (node.children as Record<string, unknown>[]) || [];
  const childrenData = children.map((c) => featureToDict(c));
  return {
    id: node.id,
    project_path: node.project_path || '',
    label: node.label || '',
    level: node.level || 1,
    parent_id: node.parent_id || null,
    description: node.description || '',
    flow_description: node.flow_description || '',
    files: toJson(node.files || []),
    functions: toJson(node.functions || []),
    generated: node.generated ? 1 : 0,
    children_json: JSON.stringify(childrenData),
    issues_json: toJson(node.issues_json || '[]'),
  };
}

export function featureToDict(row: Record<string, unknown>): Record<string, unknown> {
  // Handle nested children — already parsed by featureToDict
  const children = (row.children as Record<string, unknown>[]) || [];
  if (children.length > 0) {
    return {
      id: row.id, label: row.label, level: row.level,
      parent_id: row.parent_id,
      description: row.description || '',
      flow_description: row.flow_description || '',
      files: parseJsonField(row.files),
      functions: parseJsonField(row.functions),
      generated: !!row.generated,
      children: children.map((c) => featureToDict(c)),
    };
  }

  // Parse children_json for DB rows
  const childrenRaw = row.children_json as string;
  const parsedChildren: Record<string, unknown>[] = childrenRaw
    ? (typeof childrenRaw === 'string' ? JSON.parse(childrenRaw) : childrenRaw)
    : [];

  return {
    id: row.id, label: row.label, level: row.level,
    parent_id: row.parent_id,
    description: row.description || '',
    flow_description: row.flow_description || '',
    files: parseJsonField(row.files),
    functions: parseJsonField(row.functions),
    generated: !!row.generated,
    children: parsedChildren.map((c) => featureToDict(c)),
  };
}

export function saveFeatures(projectPath: string, features: Record<string, unknown>[]): void {
  const db = connect(projectPath);
  const del = db.prepare('DELETE FROM features WHERE project_path = ?');
  const ins = db.prepare(`
    INSERT OR REPLACE INTO features
      (id, project_path, label, level, parent_id, description, flow_description,
       files, functions, generated, children_json, issues_json, updated_at)
    VALUES (@id, @project_path, @label, @level, @parent_id, @description, @flow_description,
            @files, @functions, @generated, @children_json, @issues_json, datetime('now'))
  `);

  const transaction = db.transaction((feats: Record<string, unknown>[]) => {
    del.run(projectPath);
    for (const f of feats) {
      f.project_path = projectPath;
      ins.run(featureToRow(f));
    }
  });
  transaction(features);

  db.prepare("UPDATE meta SET value = ? WHERE key = ?").run(
    new Date().toISOString(), `last_updated_${projectPath}`,
  );
}

export function loadFeatures(projectPath: string): Record<string, unknown>[] {
  const db = connect(projectPath);
  const rows = db.prepare(
    'SELECT * FROM features WHERE project_path = ? AND parent_id IS NULL ORDER BY id',
  ).all(projectPath) as Record<string, unknown>[];
  return rows.map((r) => featureToDict(r));
}

export function findFeature(projectPath: string, nodeId: string): Record<string, unknown> | null {
  const db = connect(projectPath);
  const row = db.prepare('SELECT * FROM features WHERE id = ?').get(nodeId) as Record<string, unknown> | undefined;
  if (row) return featureToDict(row);

  // Search in children
  const allRows = db.prepare('SELECT * FROM features WHERE project_path = ?').all(projectPath) as Record<string, unknown>[];
  for (const r of allRows) {
    const d = featureToDict(r);
    const found = findInChildren(d.children as Record<string, unknown>[] || [], nodeId);
    if (found) return found;
  }
  return null;
}

function findInChildren(children: Record<string, unknown>[], nodeId: string): Record<string, unknown> | null {
  for (const c of children) {
    if (c.id === nodeId) return c;
    const found = findInChildren((c.children as Record<string, unknown>[]) || [], nodeId);
    if (found) return found;
  }
  return null;
}

export function updateFeatureOverview(projectPath: string, nodeId: string, flowDescription: string, issuesJson: string): void {
  const db = connect(projectPath);
  db.prepare(
    "UPDATE features SET flow_description = ?, issues_json = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(flowDescription, issuesJson, nodeId);
}

export function updateFeatureChildren(projectPath: string, parentId: string, children: Record<string, unknown>[]): void {
  const db = connect(projectPath);
  db.prepare(
    "UPDATE features SET children_json = ?, generated = 1, updated_at = datetime('now') WHERE id = ?",
  ).run(JSON.stringify(children), parentId);
}

/* ── Change Queue ── */

export function pushChange(projectPath: string, summary: string, filesChanged: string[]): void {
  const db = connect(projectPath);
  db.prepare(
    'INSERT INTO change_queue (project_path, summary, files_changed) VALUES (?,?,?)',
  ).run(projectPath, summary, JSON.stringify(filesChanged));
}

export function pullChanges(projectPath: string): Array<{ id: number; summary: string; files_changed: string[]; created_at: string }> {
  const db = connect(projectPath);
  const rows = db.prepare(
    'SELECT * FROM change_queue WHERE project_path = ? AND processed = 0 ORDER BY id',
  ).all(projectPath) as Record<string, unknown>[];

  db.prepare(
    'UPDATE change_queue SET processed = 1 WHERE project_path = ? AND processed = 0',
  ).run(projectPath);

  return rows.map((r) => ({
    id: r.id as number,
    summary: r.summary as string,
    files_changed: typeof r.files_changed === 'string' ? JSON.parse(r.files_changed as string) : r.files_changed,
    created_at: r.created_at as string,
  }));
}

export function hasPendingChanges(projectPath: string): boolean {
  const db = connect(projectPath);
  const row = db.prepare(
    'SELECT COUNT(*) as cnt FROM change_queue WHERE project_path = ? AND processed = 0',
  ).get(projectPath) as { cnt: number };
  return row.cnt > 0;
}

/* ── Meta store ── */

export function getMeta(projectPath: string, key: string): string | null {
  const db = connect(projectPath);
  const scoped = `${projectPath}_${key}`;
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(scoped) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(projectPath: string, key: string, value: string): void {
  const db = connect(projectPath);
  const scoped = `${projectPath}_${key}`;
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(scoped, value);
}
