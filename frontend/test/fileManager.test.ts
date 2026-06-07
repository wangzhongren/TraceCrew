/**
 * Unit tests for electron/fileManager.ts
 *
 * These tests exercise the pure file-system operations with temporary directories.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  listDirectory,
  readFile,
  writeFile,
  insertLines,
  replaceLines,
  deleteLines,
  deleteFile,
  searchInFiles,
  restoreBackup,
  getProjectName,
  type FileEntry,
  type FileContent,
  type EditResult,
} from '../../electron/fileManager';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeatlas-test-'));
});

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function mkfile(relPath: string, content: string): string {
  const abs = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
  return abs;
}

function mkdir(relPath: string): string {
  const abs = path.join(tmpDir, relPath);
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}

// ═══════════════════════════════════════════════════════════════════
// listDirectory
// ═══════════════════════════════════════════════════════════════════

describe('listDirectory', () => {
  it('returns empty array for empty directory', () => {
    const entries = listDirectory(tmpDir);
    expect(entries).toEqual([]);
  });

  it('lists files and directories sorted (dirs first)', () => {
    mkfile('b.txt', 'b');
    mkdir('a-dir');
    mkfile('a-dir/c.txt', 'c');
    mkfile('a.txt', 'a');

    const entries = listDirectory(tmpDir);
    expect(entries).toHaveLength(3);

    // Directories come first, sorted alphabetically
    expect(entries[0].name).toBe('a-dir');
    expect(entries[0].type).toBe('directory');
    expect(entries[0].children).toBeDefined();

    // Then files, sorted alphabetically
    expect(entries[1].name).toBe('a.txt');
    expect(entries[1].type).toBe('file');
    expect(entries[2].name).toBe('b.txt');
    expect(entries[2].type).toBe('file');
  });

  it('includes children for directories up to depth', () => {
    mkfile('a/b/c/d.txt', 'deep');

    const entries = listDirectory(tmpDir, 4);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('a');
    expect(entries[0].children).toHaveLength(1);
    expect(entries[0].children![0].name).toBe('b');

    // depth=1 means no children expanded
    const shallow = listDirectory(tmpDir, 1);
    expect(shallow[0].children).toEqual([]);
  });

  it('ignores common patterns (node_modules, .git, etc.)', () => {
    mkdir('node_modules');
    mkdir('.git');
    mkfile('normal.ts', 'code');
    mkfile('.DS_Store', '');

    const entries = listDirectory(tmpDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('normal.ts');
  });

  it('returns empty array for non-existent directory', () => {
    const entries = listDirectory(path.join(tmpDir, 'nope'));
    expect(entries).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// readFile
// ═══════════════════════════════════════════════════════════════════

describe('readFile', () => {
  it('reads entire file content with lines array', () => {
    const p = mkfile('hello.ts', 'line1\nline2\nline3\n');
    const result = readFile(p);

    expect(result.path).toBe(p);
    expect(result.lines).toEqual(['line1', 'line2', 'line3', '']);
    expect(result.lineCount).toBe(4);
    expect(result.content).toBe('line1\nline2\nline3\n');
  });

  it('reads a slice with startLine', () => {
    const p = mkfile('hello.ts', 'line1\nline2\nline3\nline4\n');
    const result = readFile(p, 2);

    expect(result.lines).toEqual(['line2', 'line3', 'line4', '']);
    expect(result.content).toBe('line2\nline3\nline4\n');
    expect(result.lineCount).toBe(4);
  });

  it('reads a slice with startLine and endLine', () => {
    const p = mkfile('hello.ts', 'line1\nline2\nline3\nline4\n');
    const result = readFile(p, 2, 3);

    expect(result.lines).toEqual(['line2', 'line3']);
    expect(result.content).toBe('line2\nline3');
    expect(result.lineCount).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// writeFile
// ═══════════════════════════════════════════════════════════════════

describe('writeFile', () => {
  it('creates a new file and returns success', () => {
    const p = path.join(tmpDir, 'new.ts');
    const result = writeFile(p, 'export const x = 1;');

    expect(result.success).toBe(true);
    expect(result.file).toBe(p);
    expect(result.backupId).toBeFalsy(); // no backup for new files
    expect(fs.readFileSync(p, 'utf-8')).toBe('export const x = 1;');
  });

  it('overwrites existing file and creates backup', () => {
    const p = mkfile('existing.ts', 'old content');
    const result = writeFile(p, 'new content');

    expect(result.success).toBe(true);
    expect(result.backupId).toBeTruthy(); // backup created
    expect(fs.readFileSync(p, 'utf-8')).toBe('new content');
  });

  it('creates parent directories if needed', () => {
    const p = path.join(tmpDir, 'deep', 'nested', 'file.ts');
    const result = writeFile(p, 'deep file');

    expect(result.success).toBe(true);
    expect(fs.existsSync(p)).toBe(true);
  });

  it('returns error for file path containing null bytes', () => {
    // A path with NUL character is invalid on all platforms
    const result = writeFile(path.join(tmpDir, 'invalid\x00name.ts'), 'bad');
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// insertLines
// ═══════════════════════════════════════════════════════════════════

describe('insertLines', () => {
  it('inserts content after specified line', () => {
    const p = mkfile('code.ts', 'line1\nline2\nline3\n');
    const result = insertLines(p, 1, 'inserted a\ninserted b');

    expect(result.success).toBe(true);
    const content = fs.readFileSync(p, 'utf-8');
    expect(content).toBe('line1\ninserted a\ninserted b\nline2\nline3\n');
  });

  it('inserts at the beginning with afterLine=0', () => {
    const p = mkfile('code.ts', 'line1\nline2\n');
    const result = insertLines(p, 0, 'new first');

    expect(result.success).toBe(true);
    expect(fs.readFileSync(p, 'utf-8')).toBe('new first\nline1\nline2\n');
  });

  it('creates backup for existing file', () => {
    const p = mkfile('code.ts', 'line1\nline2\n');
    const result = insertLines(p, 1, 'inserted');

    expect(result.success).toBe(true);
    expect(result.backupId).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
// replaceLines
// ═══════════════════════════════════════════════════════════════════

describe('replaceLines', () => {
  it('replaces a range of lines', () => {
    const p = mkfile('code.ts', 'line1\nline2\nline3\nline4\n');
    const result = replaceLines(p, 2, 3, 'new2\nnew3');

    expect(result.success).toBe(true);
    const content = fs.readFileSync(p, 'utf-8');
    expect(content).toBe('line1\nnew2\nnew3\nline4\n');
  });

  it('replaces single line', () => {
    const p = mkfile('code.ts', 'line1\nline2\nline3\n');
    const result = replaceLines(p, 2, 2, 'replaced');

    expect(result.success).toBe(true);
    expect(fs.readFileSync(p, 'utf-8')).toBe('line1\nreplaced\nline3\n');
  });

  it('create backup for existing file', () => {
    const p = mkfile('code.ts', 'line1\nline2\n');
    const result = replaceLines(p, 1, 1, 'new1');

    expect(result.success).toBe(true);
    expect(result.backupId).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
// deleteLines
// ═══════════════════════════════════════════════════════════════════

describe('deleteLines', () => {
  it('deletes a range of lines', () => {
    const p = mkfile('code.ts', 'line1\nline2\nline3\nline4\n');
    const result = deleteLines(p, 2, 3);

    expect(result.success).toBe(true);
    expect(fs.readFileSync(p, 'utf-8')).toBe('line1\nline4\n');
  });

  it('deletes a single line', () => {
    const p = mkfile('code.ts', 'line1\nline2\nline3\n');
    const result = deleteLines(p, 2, 2);

    expect(result.success).toBe(true);
    expect(fs.readFileSync(p, 'utf-8')).toBe('line1\nline3\n');
  });

  it('creates backup for existing file', () => {
    const p = mkfile('code.ts', 'line1\nline2\n');
    const result = deleteLines(p, 1, 1);

    expect(result.success).toBe(true);
    expect(result.backupId).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
// deleteFile
// ═══════════════════════════════════════════════════════════════════

describe('deleteFile', () => {
  it('moves file to .codeatlas/deleted trash directory', () => {
    const p = mkfile('to-delete.ts', 'content');
    const result = deleteFile(p, tmpDir);

    expect(result.success).toBe(true);
    expect(fs.existsSync(p)).toBe(false);

    // Should exist in trash
    const trashDir = path.join(tmpDir, '.codeatlas', 'deleted');
    const trashFiles = fs.readdirSync(trashDir);
    expect(trashFiles).toHaveLength(1);
    expect(trashFiles[0]).toContain('to-delete.ts');
  });

  it('returns success even if file does not exist', () => {
    const p = path.join(tmpDir, 'does-not-exist.ts');
    const result = deleteFile(p, tmpDir);
    expect(result.success).toBe(true);
  });

  it('creates backup before deleting', () => {
    const p = mkfile('delete-me.ts', 'content');
    const result = deleteFile(p, tmpDir);

    expect(result.success).toBe(true);
    expect(result.backupId).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
// restoreBackup
// ═══════════════════════════════════════════════════════════════════

describe('restoreBackup', () => {
  it('restores a backed-up file', () => {
    const p = mkfile('restore-test.ts', 'original content');
    const writeResult = writeFile(p, 'modified content');
    expect(writeResult.success).toBe(true);
    expect(writeResult.backupId).toBeTruthy();

    const result = restoreBackup(tmpDir, writeResult.backupId!);
    expect(result.success).toBe(true);
    expect(fs.readFileSync(p, 'utf-8')).toBe('original content');
  });

  it('returns error for non-existent backup', () => {
    const result = restoreBackup(tmpDir, 'nonexistent-backup-id');
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// searchInFiles
// ═══════════════════════════════════════════════════════════════════

describe('searchInFiles', () => {
  it('finds matches across source files', () => {
    mkfile('src/app.ts', 'function handleSubmit() {\n  console.log("submit");\n}');
    mkfile('src/utils.ts', 'export function handleSubmit() {}');
    mkfile('src/readme.md', '## handleSubmit reference');

    const results = searchInFiles('handleSubmit', tmpDir);
    expect(results.length).toBeGreaterThanOrEqual(2);

    const files = results.map((r) => r.file);
    expect(files).toContain('src/app.ts');
    expect(files).toContain('src/utils.ts');
  });

  it('returns line numbers with matches', () => {
    mkfile('src/test.ts', 'line1\nline2 with keyword\nline3\n');

    const results = searchInFiles('keyword', tmpDir);
    expect(results).toHaveLength(1);
    expect(results[0].line).toBe(2);
    expect(results[0].text).toContain('keyword');
  });

  it('is case insensitive', () => {
    mkfile('src/test.ts', 'HELLO world\n');

    const results = searchInFiles('hello', tmpDir);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty for no matches', () => {
    mkfile('src/test.ts', 'nothing here\n');
    const results = searchInFiles('zzz_nonexistent_zzz', tmpDir);
    expect(results).toEqual([]);
  });

  it('respects maxResults limit', () => {
    mkfile('src/a.ts', 'match\nmatch\nmatch\nmatch\nmatch\n');
    mkfile('src/b.ts', 'match\n');

    const results = searchInFiles('match', tmpDir, 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('only searches known source extensions', () => {
    mkfile('src/image.png', 'match keyword text');
    mkfile('src/data.bin', 'match keyword text');

    const results = searchInFiles('keyword', tmpDir);
    expect(results).toEqual([]);
  });

  it('handles non-existent directory', () => {
    const results = searchInFiles('test', path.join(tmpDir, 'nope'));
    expect(results).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// getProjectName
// ═══════════════════════════════════════════════════════════════════

describe('getProjectName', () => {
  it('returns the basename of the directory', () => {
    expect(getProjectName('/home/user/my-project')).toBe('my-project');
    expect(getProjectName('/a/b/c')).toBe('c');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Round-trip: write → read → modify → read → restore
// ═══════════════════════════════════════════════════════════════════

describe('workflow round-trip', () => {
  it('write → read → replace → read → restore cycle works', () => {
    const p = path.join(tmpDir, 'workflow.ts');
    writeFile(p, 'line1\nline2\nline3\nline4\nline5');

    // Read
    const fc1 = readFile(p);
    expect(fc1.lineCount).toBe(5);

    // Replace lines 2-3
    const replaceResult = replaceLines(p, 2, 3, 'new2\nnew3');
    expect(replaceResult.success).toBe(true);
    expect(replaceResult.backupId).toBeTruthy();

    // Read again
    const fc2 = readFile(p);
    expect(fc2.lines).toEqual(['line1', 'new2', 'new3', 'line4', 'line5']);

    // Insert after line 4
    insertLines(p, 4, 'inserted');
    expect(readFile(p).lines).toEqual([
      'line1', 'new2', 'new3', 'line4',
      'inserted', 'line5',
    ]);

    // Delete line 1
    deleteLines(p, 1, 1);
    expect(readFile(p).content.startsWith('new2')).toBe(true);

    // Restore to original
    const restoreResult = restoreBackup(tmpDir, replaceResult.backupId!);
    expect(restoreResult.success).toBe(true);
    expect(readFile(p).content).toBe('line1\nline2\nline3\nline4\nline5');
  });
});
