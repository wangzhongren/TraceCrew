import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import zhCN from './zh-CN.json';
import en from './en.json';
import ja from './ja.json';
import ko from './ko.json';

export type Locale = 'zh-CN' | 'en' | 'ja' | 'ko';

export const LOCALE_LABELS: Record<Locale, string> = {
  'zh-CN': '中文',
  'en': 'English',
  'ja': '日本語',
  'ko': '한국어',
};

const RESOURCES: Record<Locale, Record<string, string>> = {
  'zh-CN': zhCN,
  'en': en,
  'ja': ja,
  'ko': ko,
};

const STORAGE_KEY = 'tracecrew-locale';

/** Detect locale from browser, falling back to zh-CN */
function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in RESOURCES) return saved as Locale;
  } catch {}

  const lang = navigator.language?.toLowerCase() || '';
  if (lang.startsWith('zh')) return 'zh-CN';
  if (lang.startsWith('ja')) return 'ja';
  if (lang.startsWith('ko')) return 'ko';
  if (lang.startsWith('en')) return 'en';
  return 'zh-CN';
}

/** Interpolate variables: "Hello {name}" + {name: "World"} → "Hello World" */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`));
}

/* ── Context ── */

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'zh-CN',
  setLocale: () => {},
  t: (key) => key,
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch {}
  }, []);

  const t = useCallback((key: string, vars?: Record<string, string | number>): string => {
    const dict = RESOURCES[locale];
    const fallback = RESOURCES['zh-CN'];
    const raw = dict[key] ?? fallback[key] ?? key;
    return interpolate(raw, vars);
  }, [locale]);

  // Update <html lang> attribute for accessibility
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

/** Get translation function */
export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  return useContext(LocaleContext).t;
}

/** Get current locale and setter */
export function useLocale(): { locale: Locale; setLocale: (l: Locale) => void } {
  const { locale, setLocale } = useContext(LocaleContext);
  return { locale, setLocale };
}
