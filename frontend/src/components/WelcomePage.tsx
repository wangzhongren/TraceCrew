import { useState, useEffect } from 'react';
import { tr, type Language } from '../i18n';

const RECENT_KEY = 'codeatlas-recent-projects';

function getRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}

function saveRecent(paths: string[]) {
  const uniq = [...new Set(paths)].slice(0, 8);
  localStorage.setItem(RECENT_KEY, JSON.stringify(uniq));
}

interface Props {
  onOpenProject: (path: string) => void;
  language: Language;
  onToggleLanguage: () => void;
}

export default function WelcomePage({ onOpenProject, language, onToggleLanguage }: Props) {
  const [recent, setRecent] = useState<string[]>([]);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    setRecent(getRecent());
    // Give preload a tick to inject, then check
    setTimeout(() => setChecking(false), 300);
  }, []);

  const isElectron = typeof window.codeatlas !== 'undefined';

  const handleOpen = async () => {
    if (isElectron) {
      try {
        const p = await window.codeatlas.file.openProject();
        if (p) {
          const updated = [p, ...getRecent()];
          saveRecent(updated);
          setRecent(updated);
          onOpenProject(p);
        }
      } catch (e) {
        console.error('Failed to open project:', e);
        alert('Failed to open folder dialog');
      }
    } else {
      const demo = prompt('Enter project path:');
      if (demo) {
        const updated = [demo, ...getRecent()];
        saveRecent(updated);
        setRecent(updated);
        onOpenProject(demo);
      }
    }
  };

  const handleOpenRecent = (p: string) => {
    const updated = [p, ...getRecent().filter((r) => r !== p)];
    saveRecent(updated);
    setRecent(updated);
    onOpenProject(p);
  };

  const handleRemoveRecent = (e: React.MouseEvent, p: string) => {
    e.stopPropagation();
    const filtered = getRecent().filter((r) => r !== p);
    saveRecent(filtered);
    setRecent(filtered);
  };

  return (
    <div className="w-screen h-screen flex items-center justify-center relative bg-alt">
      {/* Close button (top-right, for frameless window) */}
      <button
        onClick={() => { try { window.codeatlas?.window?.close(); } catch { window.close(); } }}
        className="absolute top-3 right-3 w-9 h-9 flex items-center justify-center rounded-lg transition-colors hover:bg-white/10 text-subtle"
        title="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
      <button
        onClick={onToggleLanguage}
        className="absolute top-3 right-14 h-9 px-3 flex items-center justify-center rounded-lg text-xs transition-colors hover:bg-white/10 text-accent"
        style={{ border: '1px solid var(--color-accent)' }}
        title="Language">
        {language === 'zh' ? '中文' : 'EN'}
      </button>
      <div className="text-center max-w-md w-full px-8">
        {/* Logo */}
        <div className="mb-8">
          <div className="w-20 h-20 mx-auto rounded-3xl flex items-center justify-center mb-4"
            style={{ background: 'linear-gradient(135deg, #003a75, #1a3a5c)' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" className="text-accent" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="2" />
              <circle cx="5" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
              <line x1="12" y1="7" x2="5" y2="10" />
              <line x1="12" y1="7" x2="19" y2="10" />
              <line x1="7" y1="13" x2="5" y2="10" />
              <line x1="17" y1="13" x2="19" y2="10" />
              <line x1="12" y1="17" x2="7" y2="14" />
              <line x1="12" y1="17" x2="17" y2="14" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>CodeAtlas</h1>
          <p className="text-sm text-subtle">{language === 'zh' ? 'AI 代码地图' : 'CodeAtlas · AI Code Topology'}</p>
        </div>

        {/* Open Folder — primary CTA */}
        <button
          onClick={handleOpen}
          disabled={checking}
          className="w-full px-6 py-3 rounded-2xl text-sm font-medium mb-6 transition-all hover:opacity-90 disabled:opacity-50"
          style={{ background: 'var(--color-accent)', color: '#003a75' }}
        >
          {checking ? tr(language, 'loading') : tr(language, 'openFolder')}
        </button>

        {/* Connection status */}
        <div className="flex items-center justify-center gap-1.5 mb-8 text-caption text-dim">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: checking ? '#fdd663' : isElectron ? '#34a853' : 'var(--color-text-subtle)' }} />
          {checking ? tr(language, 'initializing') : isElectron ? tr(language, 'electronReady') : tr(language, 'browserMode')}
        </div>

        {/* Recent projects */}
        {recent.length > 0 && (
          <div className="text-left">
            <div className="text-xs font-medium uppercase tracking-wide mb-3 text-subtle">
              {tr(language, 'recent')}
            </div>
            <div className="space-y-1">
              {recent.map((p) => (
                <button
                  key={p}
                  onClick={() => handleOpenRecent(p)}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left text-sm group transition-colors hover:bg-white/5"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#fdd663' }} className="shrink-0" opacity="0.8">
                    <path d="M2 6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6z" />
                  </svg>
                  <div className="flex-1 truncate">
                    <div style={{ color: 'var(--color-text-primary)' }}>{p.split(/[\\/]/).pop()}</div>
                    <div className="text-xs truncate text-dim">{p}</div>
                  </div>
                  <span
                    onClick={(e) => handleRemoveRecent(e, p)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && handleRemoveRecent(e as any, p)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-white/10 transition-all cursor-pointer"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-subtle" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Keyboard hint */}
        <div className="mt-8 text-xs text-dim">
          <span className="inline-flex items-center px-1.5 py-0.5 mr-1 rounded text-caption font-mono" style={{ background: 'var(--color-border-subtle)' }}>Ctrl+K</span>
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-caption font-mono" style={{ background: 'var(--color-border-subtle)' }}>Ctrl+O</span>
          <span className="ml-1">{tr(language, 'openFolderHint')}</span>
        </div>
      </div>
    </div>
  );
}
