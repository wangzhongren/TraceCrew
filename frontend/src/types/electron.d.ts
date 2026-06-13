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
  /** Results per page (default 10) */
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

export interface TraceCrewAPI {
  file: {
    openProject: () => Promise<string | null>;
    listDirectory: (dirPath: string) => Promise<FileEntry[]>;
    readFile: (filePath: string, startLine?: number, endLine?: number) => Promise<FileContent>;
    writeFile: (filePath: string, content: string) => Promise<EditResult>;
    insertLines: (filePath: string, afterLine: number, content: string) => Promise<EditResult>;
    replaceLines: (filePath: string, startLine: number, endLine: number, content: string) => Promise<EditResult>;
    deleteLines: (filePath: string, startLine: number, endLine: number) => Promise<EditResult>;
    deleteFile: (filePath: string) => Promise<EditResult>;
    search: (query: string, dirPath: string, options?: SearchOptions) => Promise<SearchResponse>;
    restoreBackup: (backupId: string) => Promise<EditResult>;
    getProjectPath: () => Promise<string>;
    onProjectOpened: (cb: (path: string) => void) => void;
  };
  window: {
    minimize: () => Promise<void>;
    maximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    openTerminal: (projectPath?: string | null) => Promise<void>;
  };
  shell: {
    run: (command: string) => Promise<string>;
    kill: (id: string) => void;
    getLogFile: (id: string) => Promise<string | null>;
    readLog: (logFile: string) => Promise<string>;
    onData: (cb: (id: string, data: string) => void) => void;
    onDone: (cb: (id: string, code: number | null) => void) => void;
    onError: (cb: (id: string, error: string) => void) => void;
  };
  backend: {
    getUrl: () => string;
  };
  getAppIcon: () => string;
}

declare global {
  interface Window {
    tracecrew: TraceCrewAPI;
  }
}
