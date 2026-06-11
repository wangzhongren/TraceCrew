import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Text semantic tokens ──
        primary: 'var(--color-text-primary)',
        secondary: 'var(--color-text-secondary)',
        muted: 'var(--color-text-muted)',
        disabled: 'var(--color-text-disabled)',
        link: 'var(--color-text-link)',
        subtle: 'var(--color-text-subtle)',
        dim: 'var(--color-text-dim)',
        // ── Background semantic tokens ──
        'bg-primary': 'var(--color-bg-primary)',
        'bg-layer': 'var(--color-bg-layer)',
        'bg-layer-hover': 'var(--color-bg-layer-hover)',
        'bg-code': 'var(--color-bg-code)',
        'bg-alt': 'var(--color-bg-alt)',
        'bg-surface': 'var(--color-bg-surface)',
        // ── Border semantic tokens ──
        'border-subtle': 'var(--color-border-subtle)',
        'border-default': 'var(--color-border-default)',
        'border-strong': 'var(--color-border-strong)',
        // ── Accent & functional ──
        accent: 'var(--color-accent)',
        warning: 'var(--color-warning)',
        error: 'var(--color-error)',
        // ── IBM primitives (for backward compat) ──
        'ibm-bg': 'var(--ibm-bg)',
        'ibm-layer': 'var(--ibm-layer-01)',
        'ibm-layer-01': 'var(--ibm-layer-01)',
        'ibm-layer-02': 'var(--ibm-layer-02)',
        'ibm-border': 'var(--ibm-border)',
        'ibm-border-subtle': 'var(--ibm-border-subtle)',
        'ibm-text-primary': 'var(--ibm-text-primary)',
        'ibm-text-secondary': 'var(--ibm-text-secondary)',
        'ibm-text-placeholder': 'var(--ibm-text-placeholder)',
        'ibm-text-disabled': 'var(--ibm-text-disabled)',
        'ibm-primary': 'var(--ibm-primary)',
        'ibm-error': 'var(--ibm-error)',
        // ── Status colors ──
        'status-existing': 'var(--color-status-existing)',
        'status-problem': 'var(--color-status-problem)',
        'status-change': 'var(--color-status-change)',
        'status-new': 'var(--color-status-new)',
        'status-done': 'var(--color-status-done)',
      },
      fontSize: {
        caption: ['10px', { lineHeight: '14px' }],
        xs: ['11px', { lineHeight: '15px' }],
        sm: ['12px', { lineHeight: '16px' }],
        body: ['13px', { lineHeight: '18px' }],
        md: ['14px', { lineHeight: '20px' }],
        lg: ['16px', { lineHeight: '22px' }],
      },
      spacing: {
        xs: '4px',
        sm: '8px',
        md: '12px',
        lg: '16px',
        xl: '24px',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      fontFamily: {
        ui: ['var(--font-family-ui)'],
        mono: ['var(--font-family-mono)'],
      },
    },
  },
  plugins: [],
} satisfies Config;
