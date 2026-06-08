import { useState, useCallback, useEffect } from 'react';
import ChatPanel from './components/ChatPanel';
import MapperView from './components/MapperView';
import type { CallGraph } from './components/MapCanvas';
import TitleBar from './components/TitleBar';
import SettingsPanel from './components/SettingsPanel';

export interface PipelineState {
  phase: 'idle' | 'planning' | 'executing' | 'reviewing' | 'done' | 'rejected';
  graph: CallGraph | null;
}

export default function App() {
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [pipeline, setPipeline] = useState<PipelineState>({ phase: 'idle', graph: null });
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const updatePipeline = useCallback((update: Partial<PipelineState>) => {
    setPipeline(prev => ({ ...prev, ...update }));
  }, []);

  const handleOpenProject = useCallback((p: string) => setProjectPath(p), []);

  useEffect(() => {
    try { window.codeatlas?.file.onProjectOpened((p: string) => handleOpenProject(p)); } catch {}
  }, [handleOpenProject]);

  useEffect(() => {
    try {
      window.codeatlas?.file.getProjectPath().then((p: string) => { if (p) setProjectPath(p); });
    } catch {}
  }, []);

  const openFolder = async () => {
    if (typeof window.codeatlas !== 'undefined') {
      try {
        const p = await window.codeatlas.file.openProject();
        if (p) handleOpenProject(p);
      } catch (e) { console.error('openProject failed:', e); }
    } else {
      const demo = prompt('Enter project path:');
      if (demo) handleOpenProject(demo);
    }
  };

  return (
    <div className="w-screen h-screen flex flex-col" style={{ background: 'var(--ibm-bg)' }}>
      <TitleBar projectName={projectPath?.split(/[\\/]/).pop() || ''} />

      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 h-7 shrink-0 border-b"
        style={{ borderColor: 'var(--ibm-border-subtle)', background: 'var(--ibm-layer)' }}>
        <div className="flex items-center gap-2">
          {projectPath ? (
            <span className="text-[11px]" style={{ color: 'var(--ibm-text-placeholder)' }}>{projectPath}</span>
          ) : (
            <span className="text-[11px]" style={{ color: 'var(--ibm-text-disabled)' }}>No project selected</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={openFolder}
            className="text-[11px] px-2 py-0.5 rounded transition-colors hover:bg-white/5"
            style={{ color: 'var(--ibm-primary)' }}>
            {projectPath ? 'Switch Project' : 'Open Folder'}
          </button>
          <SettingsBtn />
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {projectPath ? (
          <>
            {/* Left: Chat Panel */}
            <aside className="shrink-0 border-r overflow-hidden"
              style={{ width: 420, background: 'var(--ibm-layer)', borderColor: 'var(--ibm-border-subtle)' }}>
              <ChatPanel projectPath={projectPath} onPipelineChange={updatePipeline} />
            </aside>
            {/* Right: Call Graph + Detail */}
            <main className="flex-1 flex overflow-hidden" style={{ background: 'var(--ibm-bg)' }}>
              <div className="flex-1 overflow-hidden">
                <MapperView
                  graph={pipeline.graph}
                  phase={pipeline.phase}
                  selectedNode={selectedNode}
                  onSelectNode={setSelectedNode}
                />
              </div>
            </main>
          </>
        ) : (
          <main className="flex-1 flex items-center justify-center" style={{ background: 'var(--ibm-bg)' }}>
            <div className="text-center space-y-4">
              <svg width="48" height="48" viewBox="0 0 32 32" fill="none" stroke="var(--ibm-text-disabled)" strokeWidth="1" style={{ margin: '0 auto' }}>
                <path d="M4 6h10l4 4h10v16H4z"/>
              </svg>
              <p className="text-sm" style={{ color: 'var(--ibm-text-placeholder)' }}>Open a project folder to get started</p>
              <button onClick={openFolder}
                className="px-5 py-2 text-xs font-medium rounded transition-colors"
                style={{ background: 'var(--ibm-primary)', color: '#fff' }}>
                Open Folder
              </button>
            </div>
          </main>
        )}
      </div>
    </div>
  );
}

function SettingsBtn() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} title="Settings"
        className="w-7 h-7 flex items-center justify-center rounded transition-colors hover:bg-white/5"
        style={{ color: 'var(--ibm-text-placeholder)' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
        </svg>
      </button>
      {open && <SettingsPanel onClose={() => setOpen(false)} />}
    </div>
  );
}
