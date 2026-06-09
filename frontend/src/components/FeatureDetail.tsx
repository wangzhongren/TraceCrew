import { useState, useEffect, useRef } from 'react';
import type { FeatureNode } from '../types/feature';
import { useTaskStore } from '../store/taskStore';
import { tr, type Language } from '../i18n';

interface Props {
  feature: FeatureNode | null;
  projectPath: string | null;
  onNavigateToFile: (path: string, line?: number) => void;
  onDrillDown: (node: FeatureNode) => void;
  onSendToAgent?: (context: string) => void;
  onReloadFeatures?: () => void;
  language: Language;
}

const COL = {
  surface: '#1a1c1e',
  surfaceVariant: '#282a2d',
  onSurface: '#e3e2e6',
  onSurfaceVariant: '#c4c7c5',
  outline: '#444746',
  outlineSoft: '#303234',
  primary: '#8ab4f8',
  yellow: '#d29922',
};

const LV: Record<number, string> = { 0: '#8b949e', 1: '#8ab4f8', 2: '#3fb950', 3: '#d29922' };

function resolvePath(f: string, projectPath: string | null): string {
  // Already absolute (Unix /... or Windows C:\...)
  if (/^(?:\/|[a-zA-Z]:[\\/])/.test(f)) return f;
  return projectPath ? `${projectPath.replace(/\\/g, '/')}/${f}` : f;
}

function parseFn(fn: string): { name: string; line?: number } {
  const m = fn.match(/^(.+):(\d+)$/);
  return m ? { name: m[1], line: parseInt(m[2]) } : { name: fn };
}

/* ── Simple Markdown renderer ── */
function Markdown({ text }: { text: string }) {
  if (!text) return null;
  // Split into blocks by double newline
  const blocks = text.split(/\n\n+/);
  return (
    <div className="text-sm leading-relaxed space-y-2" style={{ color: 'var(--color-text-secondary)' }}>
      {blocks.map((block, i) => {
        // Headers
        if (block.match(/^### /)) {
          return <div key={i} className="text-sm font-medium pt-1" style={{ color: '#e3e2e6' }}>{block.replace(/^### /, '')}</div>;
        }
        if (block.match(/^## /)) {
          return <div key={i} className="text-body font-semibold pt-2" style={{ color: '#f0f0f0' }}>{block.replace(/^## /, '')}</div>;
        }
        if (block.match(/^# /)) {
          return <div key={i} className="text-md font-bold pt-3" style={{ color: '#fff' }}>{block.replace(/^# /, '')}</div>;
        }
        // List items
        if (block.match(/^[-*] /m)) {
          const items = block.split('\n').filter((l) => l.match(/^[-*] /));
          return (
            <ul key={i} className="space-y-0.5 pl-4" style={{ listStyle: 'disc', color: '#8b949e' }}>
              {items.map((item, j) => (
                <li key={j} style={{ color: 'var(--color-text-secondary)' }}>
                  {renderInline(item.replace(/^[-*] /, ''))}
                </li>
              ))}
            </ul>
          );
        }
        // Code blocks
        if (block.startsWith('```')) {
          const code = block.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
          return (
            <pre key={i} className="rounded-lg p-3 text-xs overflow-x-auto" style={{ background: '#0d1117', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border-subtle)' }}>
              <code>{code}</code>
            </pre>
          );
        }
        // Regular paragraph — preserve single line breaks as <br/>
        return (
          <p key={i}>
            {block.split('\n').map((line, li) => (
              <span key={li}>
                {li > 0 && <br />}
                {renderInline(line)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function renderInline(text: string): React.ReactNode {
  // Bold, italic, inline code
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="px-0.5 rounded text-xs" style={{ background: '#21262d', color: '#f778ba' }}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

export default function FeatureDetail({ feature, projectPath, onNavigateToFile, onDrillDown, onSendToAgent, onReloadFeatures, language }: Props) {
  const [overviewHtml, setOverviewHtml] = useState<string | null>(null);
  const [overviewFiles, setOverviewFiles] = useState<Array<{path:string;description:string}>>([]);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [drilling, setDrilling] = useState(false);
  const [expandError, setExpandError] = useState<string | null>(null);
  const loadingNodeIds = useRef<Set<string>>(new Set());

  // Collect all files from tree for overview display
  useEffect(() => {
    setOverviewHtml(null);
    setOverviewFiles([]);
    if (!feature || feature.level !== 0) return;

    // Collect files from all descendants
    const allFiles: Array<{path: string; description: string}> = [];
    const collectFiles = (nodes: FeatureNode[]) => {
      for (const n of nodes) {
        for (const f of n.files || []) {
          if (!allFiles.find((x) => x.path === f)) {
            allFiles.push({ path: f, description: n.description || n.flow_description || '' });
          }
        }
        collectFiles(n.children || []);
      }
    };
    collectFiles([feature]);
    setOverviewFiles(allFiles.slice(0, 20));

    // Load cached overview + issues from node data
    const cachedOverview = feature.flow_description;
    if (cachedOverview) {
      setOverviewHtml(cachedOverview);
    } else if (!loadingNodeIds.current.has(feature.id)) {
      handleRefreshOverview();
    }

  }, [feature?.id, feature?.flow_description]);

  if (!feature) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: COL.surface }}>
        <div className="text-xs text-center" style={{ color: '#5c6166' }}>
          {tr(language, 'selectFeature')}
        </div>
      </div>
    );
  }

  const handleRefreshOverview = async () => {
    if (!feature || !projectPath) return;
    if (loadingNodeIds.current.has(feature.id)) return; // already loading this node
    setOverviewLoading(true);
    loadingNodeIds.current.add(feature.id);
    const allFiles: string[] = [];
    const collectFiles = (nodes: FeatureNode[]) => { for (const n of nodes) { allFiles.push(...(n.files || [])); collectFiles(n.children || []); } };
    collectFiles([feature]);
    const taskId = `overview_${Date.now()}`;
    useTaskStore.getState().addTask({ id: taskId, type: 'analyze', label: `${tr(language, 'analyze')}: ${feature.label}`, status: 'running', startedAt: Date.now(), detail: language === 'zh' ? '探索代码...' : 'Exploring code...' });
    try {
      const res = await fetch('/api/v1/features/overview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_path: projectPath, node_id: feature.id, files: [...new Set(allFiles)].slice(0, 10), language }),
      });
      const d = await res.json();
      setOverviewHtml(d.overview || '');
      if (d.files?.length) setOverviewFiles(d.files);
      // Update parent component with cached data so re-selecting loads from cache
      onDrillDown({ ...feature, flow_description: d.overview || feature.flow_description, generated: true });
      useTaskStore.getState().updateTask(taskId, { status: 'done', detail: `${d.issues?.length || 0} issues` });
      // Force FeatureList to reload from DB so cached data persists across navigation
      setTimeout(() => onReloadFeatures?.(), 500);
    } catch {
      useTaskStore.getState().updateTask(taskId, { status: 'error', detail: 'Failed' });
    }
    setOverviewLoading(false);
    loadingNodeIds.current.delete(feature.id);
    setTimeout(() => useTaskStore.getState().removeTask(taskId), 3000);
  };

  const handleExpand = async () => {
    if (!feature || !projectPath || drilling) return;
    setDrilling(true);
    setExpandError(null);
    try {
      const res = await fetch('/api/v1/features/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: projectPath,
          node_id: feature.id,
          parent_context: `${feature.label}: ${feature.description}\n${feature.flow_description || ''}`,
          language,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setExpandError(data.error);
      } else if (data.nodes?.length) {
        onDrillDown({ ...feature, children: data.nodes });
        onReloadFeatures?.();
      } else {
        setExpandError(language === 'zh' ? '未生成子节点' : 'No children generated');
      }
    } catch (e: any) {
      setExpandError(e.message || 'Failed');
    }
    setDrilling(false);
  };

  const handleDrill = (node: FeatureNode) => {
    if (node.children && node.children.length > 0) {
      onDrillDown(node);
    }
  };

  const children = feature.children || [];
  const isOverview = feature.level <= 1; // Level 0 root or Level 1 group → overview page

  return (
    <div className="flex flex-col h-full" style={{ background: COL.surface }}>
      {/* Header */}
      <div className="flex items-center px-4 py-2.5 border-b gap-2 shrink-0" style={{ borderColor: COL.outline }}>
        <span className="text-xs font-medium truncate flex-1" style={{ color: COL.onSurface }}>{feature.label}</span>
        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono shrink-0" style={{ background: LV[feature.level] + '20', color: LV[feature.level] }}>L{feature.level}</span>
        {onSendToAgent && (
          <button onClick={() => {
            const parts = [language === 'zh'
              ? `【参考：用户当前正在查看地图节点「${feature.label}」(L${feature.level})，以下信息仅供你参考理解上下文。请以用户的具体需求为准。】`
              : `[Reference: user is viewing map node "${feature.label}" (L${feature.level}). The info below is for context only — follow the user's request, not your own assumptions.]`];
            if (feature.description) parts.push(`描述: ${feature.description}`);
            if (feature.flow_description) parts.push(`概述: ${feature.flow_description.slice(0, 500)}`);
            if (feature.files?.length) parts.push(`相关文件: ${feature.files.join(', ')}`);
            if (feature.functions?.length) parts.push(`关键函数: ${feature.functions.join(', ')}`);
            onSendToAgent(parts.join('\n'));
          }}
            className="text-[9px] px-2 py-0.5 rounded-full shrink-0 hover:bg-white/10 transition-colors"
            style={{ border: '1px solid #303234', color: COL.primary }}>
            {tr(language, 'askAgent')}
          </button>
        )}
      </div>

      {/* ── Overview page (Level 0 / Level 1) ── */}
      {isOverview && (
        <div className="flex-1 overflow-y-auto scrollable-panel">
          {/* Loading */}
          {overviewLoading && !overviewHtml && (
            <div className="px-4 py-4 text-xs flex items-center gap-2" style={{ color: '#5c6166' }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background: '#8ab4f8' }} />
                {language === 'zh' ? '正在分析结构和问题... (10-30 秒)' : 'Analyzing structure & issues... (10-30s)'}
            </div>
          )}

          {/* Description block */}
          {(overviewHtml || feature.flow_description || feature.description) && (
            <div className="px-4 py-3 border-b" style={{ borderColor: COL.outlineSoft }}>
              <div className="mb-2">
                <span className="text-caption font-medium uppercase tracking-wide" style={{ color: '#5c6166' }}>{tr(language, 'overview')}</span>
              </div>
              <Markdown text={overviewHtml || feature.flow_description || feature.description || ''} />
            </div>
          )}

          {/* File links */}
          {(feature.files.length > 0 || overviewFiles.length > 0) && (
            <div className="px-4 py-3 border-b" style={{ borderColor: COL.outlineSoft }}>
              <div className="text-caption font-medium mb-2 uppercase tracking-wide" style={{ color: '#5c6166' }}>{tr(language, 'keyFiles')}</div>
              <div className="space-y-1.5">
                {(overviewFiles.length > 0 ? overviewFiles : feature.files.map((f: string) => ({ path: f, description: '' }))).map((f: any) => (
                  <div key={f.path} className="flex items-start gap-2">
                    <button onClick={() => onNavigateToFile(resolvePath(f.path, projectPath))}
                      className="text-xs px-2 py-0.5 rounded font-mono transition-colors hover:bg-white/10 shrink-0"
                      style={{ background: COL.surfaceVariant, color: COL.primary }}>
                      {f.path.split(/[\\/]/).pop()}
                    </button>
                    {f.description && (
                      <span className="text-caption leading-relaxed" style={{ color: '#5c6166' }}>{f.description}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Children: groups or features */}
          {children.length > 0 && (
            <div className="px-4 py-3">
              <div className="text-caption font-medium mb-2 uppercase tracking-wide" style={{ color: '#5c6166' }}>
                {feature.level === 0 ? 'Feature Groups' : 'Features'}
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {children.map((child) => (
                  <button key={child.id}
                    onClick={() => onDrillDown(child)}
                    disabled={child.level >= 3}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors hover:bg-white/[0.04] disabled:opacity-40"
                    style={{ border: '1px solid #30323440' }}>
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: LV[child.level] || '#8e918f' }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate" style={{ color: 'var(--color-text-secondary)' }}>{child.label}</div>
                      {(child.description || child.flow_description) && (
                        <div className="text-caption mt-0.5 truncate" style={{ color: '#5c6166' }}>
                          {(child.description || child.flow_description).slice(0, 60)}
                        </div>
                      )}
                      {child.files.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {child.files.slice(0, 3).map((f) => (
                            <span key={f} className="text-[9px] px-1 rounded font-mono" style={{ background: COL.surfaceVariant, color: COL.primary }}
                              onClick={(e) => { e.stopPropagation(); onNavigateToFile(resolvePath(f, projectPath)); }}>
                              {f.split(/[\\/]/).pop()}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#5c6166" strokeWidth="2" className="shrink-0 opacity-40">
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Feature detail (Level 2+) ── */}
      {!isOverview && (
        <div className="flex-1 overflow-y-auto scrollable-panel">
          {feature.flow_description && (
            <div className="px-3 py-2 border-b" style={{ borderColor: COL.outlineSoft }}>
              <Markdown text={feature.flow_description} />
            </div>
          )}
          {(feature.functions.length > 0 || feature.files.length > 0) && (
            <div className="px-3 py-2 border-b" style={{ borderColor: COL.outlineSoft }}>
              {feature.functions.length > 0 && (
                <div className="mb-2">
                  <div className="text-caption font-medium mb-1 uppercase tracking-wide" style={{ color: '#5c6166' }}>
                    {language === 'zh' ? '方法' : 'Functions'}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {feature.functions.map((fn) => {
                      const { name, line } = parseFn(fn);
                      const targetFile = feature.files[0];
                      return (
                        <button key={fn}
                          onClick={() => { if (targetFile) onNavigateToFile(resolvePath(targetFile, projectPath), line); }}
                          disabled={!targetFile}
                          className="text-left text-xs font-mono py-0.5 px-2 rounded transition-colors hover:underline disabled:opacity-40"
                          style={{ color: '#d29922', background: '#161b2220' }}>
                          {name}(){line ? `:${line}` : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {feature.files.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {feature.files.map((f) => (
                    <button key={f} onClick={() => onNavigateToFile(resolvePath(f, projectPath))}
                      className="text-[9px] px-1.5 py-0.5 rounded font-mono hover:underline"
                      style={{ background: '#1a3350', color: COL.primary }}>
                      {f.split(/[\\/]/).pop()}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
            {children.length === 0 && feature.level >= 2 ? (
              <div className="flex flex-col items-center justify-center h-full py-8 gap-2">
                <button
                  onClick={handleExpand}
                  disabled={drilling}
                  className="px-4 py-2 rounded-lg text-xs font-medium transition-all hover:opacity-90 disabled:opacity-50"
                  style={{ background: '#1a3350', color: '#8ab4f8', border: '1px solid #8ab4f830' }}>
                  {drilling ? (
                    <span className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full animate-pulse-dot" style={{ background: '#8ab4f8' }} />
                      {language === 'zh' ? '分析中...' : 'Analyzing...'}
                    </span>
                  ) : (
                    language === 'zh' ? '🔍 展开查看详情' : '🔍 Expand details'
                  )}
                </button>
                {expandError && (
                  <div className="text-caption" style={{ color: '#f85149' }}>{expandError}</div>
                )}
              </div>
            ) : children.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-xs" style={{ color: '#5c6166' }}>
                  {tr(language, 'noFurtherDetails')}
                </div>
              </div>
            ) : (
              children.map((node) => (
                <div key={node.id} className="border-b transition-colors hover:bg-white/[0.02]" style={{ borderColor: COL.outlineSoft }}>
                  <div className="flex items-start px-3 py-2.5">
                    <button
                      onClick={() => handleDrill(node)}
                      className="flex-1 text-left">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: LV[node.level] || '#8e918f' }} />
                        <span className="text-xs font-medium" style={{ color: COL.onSurface }}>{node.label}</span>
                      </div>
                      {(node.description || node.flow_description) && (
                        <div className="mt-1 ml-4 max-h-28 overflow-y-auto pr-1">
                          <Markdown text={node.flow_description || node.description} />
                        </div>
                      )}
                    </button>
                    {onSendToAgent && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSendToAgent(`当前焦点: ${feature.label} → ${node.label}\n文件: ${(node.files || []).join(', ') || '无'}`);
                        }} className="text-[9px] px-2 py-0.5 rounded-full hover:bg-white/10 ml-2"
                        style={{ border: '1px solid #303234', color: COL.primary }} title="Send to Agent">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                        </svg>
                      </button>
                    )}
                  </div>
                  {node.functions.length > 0 && (
                    <div className="px-3 pb-2 ml-4 flex flex-col gap-0.5">
                      {node.functions.map((fn) => {
                        const { name, line } = parseFn(fn);
                        return (
                          <button key={fn}
                            onClick={() => { const t = node.files[0]; if (t) onNavigateToFile(resolvePath(t, projectPath), line); }}
                            className="text-left text-xs font-mono py-0.5 px-2 rounded transition-colors hover:underline"
                            style={{ color: '#d29922', background: 'transparent' }}>
                            {name}(){line ? `:${line}` : ''}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {node.files.length > 0 && (
                    <div className="px-3 pb-2 ml-4 flex flex-wrap gap-1">
                      {node.files.map((f) => (
                        <button key={f} onClick={() => onNavigateToFile(resolvePath(f, projectPath))}
                          className="text-[9px] px-1.5 py-0.5 rounded font-mono hover:underline"
                          style={{ background: '#1a3350', color: COL.primary }}>
                          {f.split(/[\\/]/).pop()}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
        </div>
      )}
    </div>
  );
}
