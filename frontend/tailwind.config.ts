import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
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
