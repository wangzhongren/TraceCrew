import {
  readdirSync, readFileSync, writeFileSync, existsSync,
  mkdirSync, statSync, copyFileSync, renameSync, createWriteStream,
  createReadStream,
} from 'fs';
import { readdir, readFile, stat } from 'fs/promises';
import { createInterface } from 'readline';
import { join, dirname, relative, basename } from 'path';

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileEntry[];
}

export interface FileContent {
  path: string;
  lines: string[];
  content: string;
  lineCount: number;
}

export interface EditResult {
  success: boolean;
  error?: string;
  file?: string;
  backupId?: string;
}

const IGNORE_PATTERNS = [
  'node_modules', '.git', '__pycache__', '.venv', 'venv',
  'dist', '.next', '.nuxt', 'coverage', '.cache',
  '.tracecrew',
  '*.pyc', '*.pyo', '*.exe', '*.dll', '*.so', '*.dylib',
  '.DS_Store', 'Thumbs.db',
];

function shouldIgnore(name: string): boolean {
  return IGNORE_PATTERNS.some((p) => {
    if (p.includes('*')) return new RegExp('^' + p.replace(/\*/g, '.*') + '$').test(name);
    return p === name;
  });
}

export function listDirectory(dirPath: string, depth = 0): FileEntry[] {
  if (depth < 0) return [];
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    const result: FileEntry[] = [];

    for (const entry of entries) {
      if (shouldIgnore(entry.name)) continue;
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        const children = depth > 0 ? listDirectory(fullPath, depth - 1) : [];
        result.push({ name: entry.name + '/', path: fullPath, type: 'directory', children: children.length > 0 ? children : undefined });
      } else if (entry.isFile()) {
        result.push({ name: entry.name, path: fullPath, type: 'file' });
      }
    }
    return result.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  } catch {
    return [];
  }
}

export function readFile(filePath: string, startLine?: number, endLine?: number): FileContent {
  const content = readFileSync(filePath, 'utf-8');
  let lines = content.split('\n');
  if (startLine && endLine) {
    lines = lines.slice(startLine - 1, endLine);
  } else if (startLine) {
    lines = lines.slice(startLine - 1);
  }
  const sliced = lines.join('\n');
  return {
    path: filePath,
    lines,
    content: sliced,
    lineCount: lines.length,
  };
}

function findProjectRoot(filePath: string): string {
  let current = existsSync(filePath) && statSync(filePath).isDirectory()
    ? filePath
    : dirname(filePath);
  while (current !== dirname(current)) {
    if (existsSync(join(current, '.git')) || existsSync(join(current, '.tracecrew'))) {
      return current;
    }
    current = dirname(current);
  }
  return dirname(filePath);
}

function createBackup(filePath: string, operation: string): string | undefined {
  try {
    if (!existsSync(filePath)) return undefined;
    const root = findProjectRoot(filePath);
    const rel = relative(root, filePath);
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const backupDir = join(root, '.tracecrew', 'backups', id);
    mkdirSync(backupDir, { recursive: true });
    const backupFile = join(backupDir, 'before');
    copyFileSync(filePath, backupFile);
    writeFileSync(join(backupDir, 'meta.json'), JSON.stringify({
      id,
      operation,
      file: rel,
      createdAt: new Date().toISOString(),
    }, null, 2), 'utf-8');
    return id;
  } catch {
    return undefined;
  }
}

export function restoreBackup(projectPath: string, backupId: string): EditResult {
  try {
    const backupDir = join(projectPath, '.tracecrew', 'backups', backupId);
    const metaPath = join(backupDir, 'meta.json');
    const backupFile = join(backupDir, 'before');
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    const target = join(projectPath, meta.file);
    const dir = dirname(target);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    copyFileSync(backupFile, target);
    return { success: true, file: target, backupId };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

export function writeFile(filePath: string, content: string): EditResult {
  try {
    const backupId = createBackup(filePath, 'write_file');
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, content, 'utf-8');
    return { success: true, file: filePath, backupId };
  } catch (e: any) {
    return { success: false, error: e.message, file: filePath };
  }
}

/** Stream lines from source to temp file, applying an edit operation.
 *  Only keeps one line in memory at a time — safe for 10MB+ files. */
function streamEdit(
  filePath: string,
  op: 'insert' | 'replace' | 'delete',
  targetLine: number,    // insert: after this line; replace/delete: start line
  rangeEnd: number,       // replace/delete: end line (inclusive)
  content?: string,
): Promise<EditResult> {
  return new Promise((resolve) => {
    const tmpPath = filePath + '.tmp.' + Date.now();
    const input = createReadStream(filePath, 'utf-8');
    const output = createWriteStream(tmpPath, { flags: 'w' });
    const rl = createInterface({ input, crlfDelay: Infinity });

    const newChunk = content ? content.split('\n') : [];
    let lineNum = 0;
    let skipping = false;

    rl.on('line', (line) => {
      lineNum++;
      if (skipping) {
        if (lineNum > rangeEnd) {
          skipping = false;
          output.write(line + '\n');
        }
        return;
      }

      if (op === 'replace' && lineNum === targetLine) {
        for (const l of newChunk) output.write(l + '\n');
        if (rangeEnd > targetLine) skipping = true;
        return;
      }

      if (op === 'delete' && lineNum === targetLine) {
        if (rangeEnd > targetLine) skipping = true;
        return;
      }

      if (op === 'insert' && lineNum === targetLine) {
        output.write(line + '\n');
        for (const l of newChunk) output.write(l + '\n');
        return;
      }

      output.write(line + '\n');
    });

    rl.on('close', () => {
      output.end(() => {
        try {
          renameSync(tmpPath, filePath);
          resolve({ success: true, file: filePath });
        } catch (e: any) {
          resolve({ success: false, error: e.message, file: filePath });
        }
      });
    });

    rl.on('error', (err) => {
      output.end();
      resolve({ success: false, error: err.message, file: filePath });
    });
  });
}

export async function insertLines(filePath: string, afterLine: number, content: string): Promise<EditResult> {
  try {
    const backupId = createBackup(filePath, 'insert_lines');
    // Use streaming for large files, in-memory for small ones
    const st = statSync(filePath);
    if (st.size > 500_000) {
const r = await streamEdit(filePath, 'insert', afterLine, afterLine, content);
      return { ...r, backupId };
    }
    const fc = readFile(filePath);
    const newLines = [...fc.lines];
    newLines.splice(afterLine, 0, ...content.split('\n'));
    writeFileSync(filePath, newLines.join('\n'), 'utf-8');
    return { success: true, file: filePath, backupId };
  } catch (e: any) {
    return { success: false, error: e.message, file: filePath };
  }
}

export async function replaceLines(
  filePath: string, startLine: number, endLine: number, content: string
): Promise<EditResult> {
  try {
    const backupId = createBackup(filePath, 'replace_lines');
    const st = statSync(filePath);
    if (st.size > 500_000) {
      const r = await streamEdit(filePath, 'replace', startLine, endLine, content);
      return { ...r, backupId };
    }
    const fc = readFile(filePath);
    const newLines = [...fc.lines];
    newLines.splice(startLine - 1, endLine - startLine + 1, ...content.split('\n'));
    writeFileSync(filePath, newLines.join('\n'), 'utf-8');
    return { success: true, file: filePath, backupId };
  } catch (e: any) {
    return { success: false, error: e.message, file: filePath };
  }
}

export async function deleteLines(filePath: string, startLine: number, endLine: number): Promise<EditResult> {
  try {
    const backupId = createBackup(filePath, 'delete_lines');
    const st = statSync(filePath);
    if (st.size > 500_000) {
      const r = await streamEdit(filePath, 'delete', startLine, endLine);
      return { ...r, backupId };
    }
    const fc = readFile(filePath);
    const newLines = [...fc.lines];
    newLines.splice(startLine - 1, endLine - startLine + 1);
    writeFileSync(filePath, newLines.join('\n'), 'utf-8');
    return { success: true, file: filePath, backupId };
  } catch (e: any) {
    return { success: false, error: e.message, file: filePath };
  }
}

export function deleteFile(filePath: string, projectPath: string): EditResult {
  try {
    const backupId = createBackup(filePath, 'delete_file');
    if (existsSync(filePath)) {
      const trashDir = join(projectPath, '.tracecrew', 'deleted');
      mkdirSync(trashDir, { recursive: true });
      const name = basename(filePath);
      const ts = Date.now();
      const trashPath = join(trashDir, `${ts}_${name}`);
      renameSync(filePath, trashPath);
    }
    return { success: true, file: filePath, backupId };
  } catch (e: any) {
    return { success: false, error: e.message, file: filePath };
  }
}

export interface SearchResult {
  file: string;
  line: number;
  text: string;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
}

export interface SearchOptions {
  /** Results per page (default 10, max 50) */
  maxResults?: number;
  /** Max results per file (default unlimited) */
  maxResultsPerFile?: number;
  /** Pagination: skip first N results */
  offset?: number;
  /** Case-sensitive match (default false) */
  caseSensitive?: boolean;
  /** Whole-word match only (default false) */
  wholeWord?: boolean;
  /** Treat query as regex (default false) */
  useRegex?: boolean;
  /** Max file size in bytes to read (default 200KB) */
  maxFileSize?: number;
  /** File extensions to search (default: common source types) */
  sourceExts?: string[];
}

const DEFAULT_SOURCE_EXTS = [
  '.py', '.ts', '.tsx', '.js', '.jsx', '.go', '.rs', '.java',
  '.json', '.toml', '.yaml', '.yml', '.md', '.css', '.html', '.vue', '.svelte',
  '.sh', '.sql', '.xml', '.prisma', '.graphql', '.proto',
];

export async function searchInFiles(
  query: string,
  dirPath: string,
  options: SearchOptions = {},
): Promise<SearchResponse> {
  const {
    maxResults = 10,
    maxResultsPerFile = 0,
    offset = 0,
    caseSensitive = false,
    wholeWord = false,
    useRegex = false,
    maxFileSize = 200_000,
    sourceExts = DEFAULT_SOURCE_EXTS,
  } = options;

  const MAX_SCAN = 500; // upper bound to prevent runaway scans
  const allResults: SearchResult[] = [];

  // Build matcher
  let matcher: (line: string) => boolean;
  if (useRegex) {
    const flags = caseSensitive ? 'g' : 'gi';
    const re = new RegExp(query, flags);
    matcher = (line) => re.test(line);
  } else if (wholeWord) {
    const flags = caseSensitive ? 'g' : 'gi';
    const re = new RegExp(`\\b${escapeRegex(query)}\\b`, flags);
    matcher = (line) => re.test(line);
  } else if (caseSensitive) {
    matcher = (line) => line.includes(query);
  } else {
    const lower = query.toLowerCase();
    matcher = (line) => line.toLowerCase().includes(lower);
  }

  async function walk(dir: string): Promise<void> {
    if (allResults.length >= MAX_SCAN) return;
    let entries;
    try { entries = await readdir(dir); }
    catch { return; }

    for (const name of entries) {
      if (allResults.length >= MAX_SCAN) return;
      if (shouldIgnore(name)) continue;
      const full = join(dir, name);
      try {
        const st = await stat(full);
        if (st.isDirectory()) {
          await walk(full);
        } else if (st.isFile() && st.size < maxFileSize) {
          const isDotfile = name.startsWith('.');
          const ext = name.includes('.') ? '.' + name.split('.').pop()?.toLowerCase() : '';
          if (!isDotfile && ext !== '' && !sourceExts.includes(ext)) continue;
          const content = await readFile(full, 'utf-8');
          const lines = content.split('\n');
          let fileHits = 0;
          for (let i = 0; i < lines.length && allResults.length < MAX_SCAN; i++) {
            if (matcher(lines[i])) {
              allResults.push({
                file: relative(dirPath, full).replace(/\\/g, '/'),
                line: i + 1,
                text: lines[i].trim().slice(0, 200),
              });
              fileHits++;
              if (maxResultsPerFile > 0 && fileHits >= maxResultsPerFile) break;
            }
          }
        }
      } catch { /* skip unreadable */ }
    }
  }

  await walk(dirPath);
  const total = allResults.length;
  const results = allResults.slice(offset, offset + maxResults);
  return { results, total };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getProjectName(dirPath: string): string {
  return basename(dirPath);
}

/* ── Shell execution ── */
import { spawn, ChildProcess } from 'child_process';

interface RunningProcess {
  child: ChildProcess;
  logFile: string;
}

const runningProcesses = new Map<string, RunningProcess>();

export function runShell(
  command: string,
  cwd: string,
  onData: (data: string) => void,
  onDone: (code: number | null) => void,
  onError: (err: string) => void,
): string {
  const id = `shell_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // Write output to a log file as well
  const logDir = join(cwd, '.tracecrew-logs');
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
  const logFile = join(logDir, `${id}.log`);
  const logStream = createWriteStream(logFile, { flags: 'a' });

  const log = (text: string) => {
    logStream.write(text);
    onData(text);
  };

  // Use spawn for streaming, supports long-running processes
  const child = spawn(command, [], {
    cwd,
    shell: true,
    detached: process.platform !== 'win32',
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  runningProcesses.set(id, { child, logFile });

  log(`$ ${command}\n\n`);

  child.stdout?.on('data', (d: Buffer) => log(d.toString()));
  child.stderr?.on('data', (d: Buffer) => log(d.toString()));

  child.on('close', (code) => {
    log(`\n[exit ${code}]\n`);
    logStream.end();
    runningProcesses.delete(id);
    onDone(code);
  });

  child.on('error', (err) => {
    log(`\n[error: ${err.message}]\n`);
    logStream.end();
    runningProcesses.delete(id);
    onError(err.message);
  });

  return id;
}

export function getShellLogFile(id: string): string | null {
  const proc = runningProcesses.get(id);
  return proc ? proc.logFile : null;
}

export function readLogFile(logFile: string): string {
  try { return readFileSync(logFile, 'utf-8'); } catch { return ''; }
}

export function killShell(id: string): boolean {
  const proc = runningProcesses.get(id);
  if (proc) {
    const pid = proc.child.pid;
    if (pid && process.platform !== 'win32') {
      try { process.kill(-pid, 'SIGTERM'); } catch { proc.child.kill(); }
    } else {
      proc.child.kill();
    }
    runningProcesses.delete(id);
    return true;
  }
  return false;
}

export function killAllShells(): void {
  for (const id of Array.from(runningProcesses.keys())) {
    killShell(id);
  }
}
