/* ── Shared API types ── */

export interface AgentRequest {
  instruction: string;
  open_file?: {
    path: string;
    content: string;
    lines: number;
  } | null;
  file_tree?: FileTreeEntry[] | null;
  history?: Array<{ role: string; content: string }> | null;
  selection?: {
    file: string;
    text: string;
    lines: string;
  } | null;
}

export interface FileTreeEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeEntry[];
}

export interface FileOperation {
  type: string;
  file?: string;
  start_line?: number;
  end_line?: number;
  after_line?: number;
  content?: string;
}

export interface AgentResponse {
  message: string;
  operations: FileOperation[];
}

export interface FeatureNode {
  id: string;
  label: string;
  level: number;
  parent_id: string | null;
  description: string;
  flow_description: string;
  files: string[];
  functions: string[];
  children: FeatureNode[];
  generated: boolean;
  issues_json?: string;
}
