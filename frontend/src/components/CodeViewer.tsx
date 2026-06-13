import { useState, useEffect, useCallback, useRef } from 'react';
import type { FileContent } from '../types/electron.d';

export interface CodeSelection {
  text: string;
  startLine: number;
  endLine: number;
  filePath: string;
}

interface Props {
  filePath: string | null;
  projectPath: string | null;
  scrollToLine?: number | null;
  onSelectionChange?: (sel: CodeSelection | null) => void;
}

const SYNTAX_COLORS: Record<string, string> = {
  keyword: '#2563eb',
  string: '#16a34a',
  comment: '#9ca3af',
  function: '#b45309',
  number: '#dc2626',
  type: '#7c3aed',
};

// Lightweight syntax highlighting
function highlightLine(line: string, _ext: string): string {
  let html = line
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Comments
  html = html.replace(/(\/\/.*$|\/\*[\s\S]*?\*\/)/g, (m) =>
    `<span style="color:${SYNTAX_COLORS.comment};font-style:italic">${m}</span>`);

  // Strings
  html = html.replace(/("[^"]*"|'[^']*'|`[^`]*`)/g, (m) =>
    `<span style="color:${SYNTAX_COLORS.string}">${m}</span>`);

  // Keywords
  html = html.replace(
    /\b(import|export|from|const|let|var|function|class|return|if|else|for|while|async|await|try|catch|throw|new|extends|implements|interface|type|enum|default|switch|case|break|continue|do|of|in|instanceof|typeof|void|delete|this|super|static|public|private|protected|readonly|abstract|get|set|def|pass|raise|except|finally|with|as|is|not|and|or|None|True|False|self|print|yield|lambda|global|nonlocal|assert|import|from)\b/g,
    (m) => `<span style="color:${SYNTAX_COLORS.keyword}">${m}</span>`
  );

  // Numbers
  html = html.replace(/\b(\d+\.?\d*)\b/g, (m) =>
    `<span style="color:${SYNTAX_COLORS.number}">${m}</span>`);

  // Function calls
  html = html.replace(/\b([a-zA-Z_]\w*)\s*\(/g, (_, name) =>
    `<span style="color:${SYNTAX_COLORS.function}">${name}</span>(`);

  return html;
}

function getFileExt(filePath: string): string {
  const parts = filePath.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

export default function CodeViewer({ filePath, projectPath, scrollToLine, onSelectionChange }: Props) {
  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Scroll to line when content is loaded and scrollToLine is set
  useEffect(() => {
    if (scrollToLine && content && tableRef.current) {
      // Small delay to ensure DOM is rendered
      const timer = setTimeout(() => {
        const rows = tableRef.current?.querySelectorAll('tr');
        if (rows && rows[scrollToLine - 1]) {
          rows[scrollToLine - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
          rows[scrollToLine - 1].style.background = '#dbeafe';
          setTimeout(() => { rows[scrollToLine - 1].style.background = ''; }, 2000);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [scrollToLine, content]);

  const loadFile = useCallback(async () => {
    if (!filePath || !projectPath) return;
    setLoading(true);
    setError(null);
    try {
      const fc = await window.tracecrew.file.readFile(filePath);
      if (fc && fc.content !== undefined) {
        setContent(fc);
      } else {
        setContent(null);
        setError(`Empty content: ${filePath}`);
      }
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes('ENOENT')) {
        setError(`File not found: ${filePath}`);
      } else {
        setError(`Failed to read: ${msg}`);
      }
      setContent(null);
    }
    setLoading(false);
  }, [filePath, projectPath]);

  useEffect(() => { loadFile(); }, [loadFile]);

  // Track text selection and emit line range
  const handleSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !tableRef.current || !filePath) {
      onSelectionChange?.(null);
      return;
    }
    const text = sel.toString().trim();
    if (!text) { onSelectionChange?.(null); return; }

    const rows = tableRef.current.querySelectorAll('tr');
    let startLine = 0, endLine = 0;
    rows.forEach((row, i) => {
      if (sel.containsNode(row, true)) {
        if (!startLine) startLine = i + 1;
        endLine = i + 1;
      }
    });

    onSelectionChange?.({ text, startLine, endLine, filePath });
  }, [filePath, onSelectionChange]);

  // Clear selection on file change
  useEffect(() => { onSelectionChange?.(null); }, [filePath, onSelectionChange]);

  if (!filePath) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: '#ffffff' }}>
        <div className="text-center" style={{ color: '#9ca3af' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mx-auto mb-3 opacity-30">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <div className="text-sm">Select a file to view</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: '#ffffff' }}>
        <div className="text-xs" style={{ color: '#9ca3af' }}>Loading...</div>
      </div>
    );
  }

  if (!content) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: '#ffffff' }}>
        <div className="text-center max-w-xs px-4">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="1" className="mx-auto mb-2 opacity-50">
            <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <div className="text-xs" style={{ color: '#dc2626' }}>{error || 'Failed to load file'}</div>
          <div className="text-[9px] mt-1 opacity-50" style={{ color: '#9ca3af', wordBreak: 'break-all' }}>
            {filePath}
          </div>
        </div>
      </div>
    );
  }

  const ext = getFileExt(filePath);
  const displayPath = projectPath ? filePath.replace(projectPath, '').replace(/^[\\/]/, '') : filePath;

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: '#ffffff' }}>
      {/* File header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b text-xs" style={{ borderColor: '#e5e7eb', background: '#f7f8fa' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span className="font-medium" style={{ color: '#1a1a2e' }}>{displayPath}</span>
        <span style={{ color: '#9ca3af' }}>{content.lineCount} lines</span>
      </div>

      {/* Code area */}
      <div ref={containerRef} className="flex-1 overflow-auto" onMouseUp={handleSelection}>
        <table ref={tableRef} className="w-full border-collapse font-mono text-xs leading-5" style={{ fontFamily: 'var(--font-family-mono)' }}>
          <tbody>
            {content.lines.map((line, i) => (
              <tr
                key={i}
                className="hover:bg-gray-50 transition-colors duration-100"
              >
                <td
                  className="text-right pr-3 pl-4 select-none border-r w-[1%] align-top whitespace-nowrap"
                  style={{ color: '#9ca3af', borderColor: '#e5e7eb', paddingTop: 1, paddingBottom: 1 }}
                >
                  {i + 1}
                </td>
                <td className="pl-4 pr-4 align-top whitespace-pre-wrap break-words" style={{ paddingTop: 1, paddingBottom: 1 }}>
                  <span dangerouslySetInnerHTML={{ __html: highlightLine(line, ext) || ' ' }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
