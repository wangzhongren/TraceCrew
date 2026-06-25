import { useState, useEffect } from 'react';
import { useT } from '../i18n';

interface LLMSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const STORAGE_KEY = 'tracecrew-llm-settings';

function loadLocal(): LLMSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function save(s: LLMSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [settings, setSettings] = useState<LLMSettings>(() => loadLocal() || { apiKey: '', baseUrl: '', model: '' });
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  // On mount: if no localStorage, fetch from backend (reads .env)
  useEffect(() => {
    if (loadLocal()) { setLoading(false); return; }
    fetch('/api/v1/settings')
      .then((r) => r.json())
      .then((d) => {
        setSettings({ apiKey: d.apiKey || '', baseUrl: d.baseUrl || '', model: d.model || '' });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleSave = async () => {
    save(settings);
    // Tell the backend to reload settings
    try {
      await fetch('/api/v1/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
    } catch {}
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 10px',
    fontSize: '13px',
    fontFamily: 'ui-monospace, monospace',
    color: 'var(--color-text-primary)',
    background: 'var(--color-bg-primary)',
    border: '1px solid var(--color-border-default)',
    borderRadius: '6px',
    outline: 'none',
  };

  return (
    <div className="absolute right-0 top-8 w-80 rounded-lg border z-50 animate-fade-in-scale"
      style={{ background: 'var(--color-bg-layer)', borderColor: 'var(--color-border-default)', boxShadow: '0 4px 16px rgba(0,0,0,0.08)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
        <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>{t('settings.llm')}</span>
        <button onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded transition-colors hover:bg-black/[0.03]"
          style={{ color: 'var(--color-text-muted)' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>

      {/* Fields */}
      <div className="px-4 py-3 space-y-3">
        {loading && (
          <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('settings.loading')}</div>
        )}
        <label className="block">
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('settings.apiKey')}</span>
          <input
            type="password"
            value={settings.apiKey}
            onChange={(e) => setSettings((s) => ({ ...s, apiKey: e.target.value }))}
            placeholder="sk-..."
            style={fieldStyle}
            className="mt-1"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('settings.baseUrl')}</span>
          <input
            type="text"
            value={settings.baseUrl}
            onChange={(e) => setSettings((s) => ({ ...s, baseUrl: e.target.value }))}
            placeholder="https://api.openai.com/v1"
            style={fieldStyle}
            className="mt-1"
          />
        </label>

        <label className="block">
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>{t('settings.model')}</span>
          <input
            type="text"
            value={settings.model}
            onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
            placeholder="gpt-4o"
            style={fieldStyle}
            className="mt-1"
          />
        </label>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t" style={{ borderColor: 'var(--color-border-subtle)' }}>
        <span className="text-xs" style={{ color: saved ? '#24a148' : 'transparent' }}>
          {t('settings.saved')}
        </span>
        <button onClick={handleSave}
          className="px-4 py-1.5 text-xs font-medium rounded transition-colors"
          style={{ background: '#2563eb', color: '#fff' }}>
          {t('settings.save')}
        </button>
      </div>
    </div>
  );
}
