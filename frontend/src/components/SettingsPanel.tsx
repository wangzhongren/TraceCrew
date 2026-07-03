import { useState, useEffect } from 'react';
import { useT } from '../i18n';

interface AgentLLMSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface AllLLMSettings {
  pm: AgentLLMSettings;
  architect: AgentLLMSettings;
  planner: AgentLLMSettings;
  reviewer: AgentLLMSettings;
  mapper: AgentLLMSettings;
  executor: AgentLLMSettings;
}

const STORAGE_KEY = 'tracecrew-llm-settings-v2';
const OLD_STORAGE_KEY = 'tracecrew-llm-settings';

const AGENT_KEYS = ['pm', 'architect', 'planner', 'reviewer', 'mapper', 'executor'] as const;

const AGENT_LABELS: Record<string, string> = {
  pm: 'settings.agentPm',
  architect: 'settings.agentArchitect',
  planner: 'settings.agentPlanner',
  reviewer: 'settings.agentReviewer',
  mapper: 'settings.agentMapper',
  executor: 'settings.agentExecutor',
};

function defaultAgentSettings(): AgentLLMSettings {
  return { apiKey: '', baseUrl: '', model: '' };
}

function defaultAllSettings(): AllLLMSettings {
  return {
    pm: defaultAgentSettings(),
    architect: defaultAgentSettings(),
    planner: defaultAgentSettings(),
    reviewer: defaultAgentSettings(),
    mapper: defaultAgentSettings(),
    executor: defaultAgentSettings(),
  };
}

/** Migrate from old single-LLM format to new per-agent format */
function migrateOldFormat(old: { apiKey?: string; baseUrl?: string; model?: string }): AllLLMSettings {
  const shared: AgentLLMSettings = {
    apiKey: old.apiKey || '',
    baseUrl: old.baseUrl || '',
    model: old.model || '',
  };
  return {
    pm: { ...shared },
    architect: { ...shared },
    planner: { ...shared },
    reviewer: { ...shared },
    mapper: { ...shared },
    executor: { ...shared },
  };
}

function loadLocal(): AllLLMSettings | null {
  try {
    // Try new format first
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const loaded = JSON.parse(raw);
      // Merge with defaults to fill any missing agent keys (e.g. newly added Architect)
      const defaults = defaultAllSettings();
      const merged: any = { ...loaded };
      for (const key of Object.keys(defaults)) {
        if (!merged[key]) merged[key] = defaults[key as keyof AllLLMSettings];
      }
      return merged as AllLLMSettings;
    }
    // Try old format and migrate
    const oldRaw = localStorage.getItem(OLD_STORAGE_KEY);
    if (oldRaw) {
      const old = JSON.parse(oldRaw);
      const migrated = migrateOldFormat(old);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      localStorage.removeItem(OLD_STORAGE_KEY);
      return migrated;
    }
  } catch {}
  return null;
}

function saveLocal(s: AllLLMSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [settings, setSettings] = useState<AllLLMSettings>(() => loadLocal() || defaultAllSettings());
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  // On mount: if no localStorage, fetch from backend (reads .env)
  useEffect(() => {
    if (loadLocal()) { setLoading(false); return; }
    fetch('/api/v1/settings')
      .then((r) => r.json())
      .then((d) => {
        // Backend returns { pm: {...}, planner: {...}, ... }
        if (d.pm) {
          setSettings(d as AllLLMSettings);
        }
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
    saveLocal(settings);
    try {
      const res = await fetch('/api/v1/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const result = await res.json().catch(() => ({}));
      console.log('[Settings] 保存结果:', result, '| architect:', settings.architect?.apiKey ? '***' + settings.architect.apiKey.slice(-4) : '(empty)');
    } catch (e) {
      console.error('[Settings] 保存失败:', e);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const updateAgent = (agent: string, field: string, value: string) => {
    setSettings((prev) => ({
      ...prev,
      [agent]: { ...prev[agent as keyof AllLLMSettings], [field]: value },
    }));
  };

  const toggleExpand = (agent: string) => {
    setExpanded((prev) => (prev === agent ? null : agent));
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

  const renderAgentSection = (agent: string) => {
    const cfg = settings[agent as keyof AllLLMSettings];
    const isExpanded = expanded === agent;
    const labelKey = AGENT_LABELS[agent] || agent;

    return (
      <div key={agent} className="border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
        {/* Section header */}
        <button
          onClick={() => toggleExpand(agent)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-black/[0.02] transition-colors"
        >
          <span className="text-xs font-medium" style={{ color: 'var(--color-text-primary)' }}>
            {t(labelKey)}
          </span>
          <svg
            width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{
              color: 'var(--color-text-muted)',
              transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.15s',
            }}
          >
            <path d="M6 9l6 6 6-6"/>
          </svg>
        </button>

        {/* Collapsible fields */}
        {isExpanded && (
          <div className="px-4 pb-3 space-y-2.5">
            <label className="block">
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                {t('settings.apiKey')}
              </span>
              <input
                type="password"
                value={cfg.apiKey}
                onChange={(e) => updateAgent(agent, 'apiKey', e.target.value)}
                placeholder="sk-..."
                style={fieldStyle}
                className="mt-0.5"
              />
            </label>

            <label className="block">
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                {t('settings.baseUrl')}
              </span>
              <input
                type="text"
                value={cfg.baseUrl}
                onChange={(e) => updateAgent(agent, 'baseUrl', e.target.value)}
                placeholder="https://api.openai.com/v1"
                style={fieldStyle}
                className="mt-0.5"
              />
            </label>

            <label className="block">
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                {t('settings.model')}
              </span>
              <input
                type="text"
                value={cfg.model}
                onChange={(e) => updateAgent(agent, 'model', e.target.value)}
                placeholder="gpt-4o"
                style={fieldStyle}
                className="mt-0.5"
              />
            </label>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="absolute right-0 top-8 w-96 rounded-lg border z-50 animate-fade-in-scale"
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

      {/* Agent sections */}
      <div className="max-h-[480px] overflow-y-auto">
        {loading && (
          <div className="px-4 py-3 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {t('settings.loading')}
          </div>
        )}
        {AGENT_KEYS.map(renderAgentSection)}
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
