import { useState, useCallback, useEffect } from 'react';
import ChatPanel from './components/ChatPanel';
import MapCanvas from './components/MapCanvas';
import type { CallGraph } from './components/MapCanvas';
import TitleBar from './components/TitleBar';
import SettingsPanel from './components/SettingsPanel';

export interface PipelineState {
  phase: 'idle' | 'planning' | 'executing' | 'reviewing' | 'done' | 'rejected';
  graph: CallGraph | null;
  steps?: any[];
}

export default function App() {
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [pipeline, setPipeline] = useState<PipelineState>({
    phase: 'idle', graph: null,
  });

  const handleOpenProject = useCallback((p: string) => setProjectPath(p), []);

  useEffect(() => {
    try { window.codeatlas?.file.onProjectOpened((p: string) => handleOpenProject(p)); } catch {}
  }, [handleOpenProject]);

  useEffect(() => {
    try {
      window.codeatlas?.file.getProjectPath().then((p: string) => { if (p) setProjectPath(p); });
    } catch {}
  }, []);

  if (!projectPath) {
    return (
      <div className="w-screen h-screen flex items-center justify-center relative" style={{ background: 'var(--ibm-bg)' }}>
        {/* Close button — for frameless window */}
        <button
          onClick={() => {
            if (window.codeatlas?.window?.close) {
              window.codeatlas.window.close();
            } else {
              window.close();
            }
          }}
          className="absolute top-3 right-3 w-10 h-10 flex items-center justify-center rounded-lg transition-colors"
          style={{ color: 'var(--ibm-text-placeholder)' }}
          title="Close"
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--ibm-layer-hover)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>

        <div className="text-center space-y-6">
          <div className="w-16 h-16 mx-auto rounded-xl flex items-center justify-center"
            style={{ background: 'var(--ibm-primary)' }}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="white" strokeWidth="2">
              <circle cx="7" cy="7" r="2"/><circle cx="25" cy="7" r="2"/><circle cx="16" cy="20" r="2"/>
              <circle cx="10" cy="25" r="2"/><circle cx="22" cy="25" r="2"/>
              <line x1="9" y1="8" x2="15" y2="19"/><line x1="23" y1="8" x2="17" y2="19"/>
            </svg>
          </div>
          <h1 className="text-xl font-light tracking-wide" style={{ color: 'var(--ibm-text)' }}>CodeAtlas</h1>
          <p className="text-sm" style={{ color: 'var(--ibm-text-secondary)' }}>AI-Powered Code Topology</p>
          <button
            onClick={async () => {
              // Electron: use dialog
              if (typeof window.codeatlas !== 'undefined') {
                try {
                  const p = await window.codeatlas.file.openProject();
                  if (p) handleOpenProject(p);
                } catch (e) {
                  console.error('openProject failed:', e);
                }
              } else {
                // Browser fallback
                const demo = prompt('Enter project path:');
                if (demo) handleOpenProject(demo);
              }
            }}
            className="px-8 py-3 text-sm font-medium transition-colors rounded-lg"
            style={{ background: 'var(--ibm-primary)', color: '#fff' }}>
            Open Folder
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex flex-col" style={{ background: 'var(--ibm-bg)' }}>
      <TitleBar projectName={projectPath?.split(/[\\/]/).pop() || ''} />

      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 h-7 shrink-0 border-b" style={{ borderColor: 'var(--ibm-border-subtle)', background: 'var(--ibm-layer)' }}>
        <span className="text-[11px]" style={{ color: 'var(--ibm-text-placeholder)' }}>{projectPath}</span>
        <div className="flex items-center gap-1">
          <SettingsBtn />
          <button onClick={() => setProjectPath(null)}
            className="text-[11px] px-2 py-0.5 rounded transition-colors hover:bg-white/5"
            style={{ color: 'var(--ibm-text-secondary)' }}>
            Close Project
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: Chat Panel */}
        <aside className="shrink-0 border-r overflow-hidden"
          style={{ width: 420, background: 'var(--ibm-layer)', borderColor: 'var(--ibm-border-subtle)' }}>
          <ChatPanel projectPath={projectPath} onPipelineChange={setPipeline} />
        </aside>

        {/* Right: Call Graph */}
        <main className="flex-1 overflow-hidden" style={{ background: 'var(--ibm-bg)' }}>
          <MapCanvas graph={pipeline.graph} phase={pipeline.phase} />
        </main>
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
