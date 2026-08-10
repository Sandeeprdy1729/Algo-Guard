import type { Config } from 'tailwindcss';

// Every colour resolves to a CSS custom property so the same utility
// class (bg-bg, text-muted, border-border-2, etc.) responds to the
// theme class on <html>. Light + dark palettes live in globals.css.
const rgb = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:            rgb('--c-bg'),
        surface:       rgb('--c-surface'),
        'surface-2':   rgb('--c-surface-2'),
        border:        rgb('--c-border'),
        'border-2':    rgb('--c-border-2'),

        text:          rgb('--c-text'),
        'text-2':      rgb('--c-text-2'),
        muted:         rgb('--c-muted'),
        dim:           rgb('--c-dim'),

        ok:            rgb('--c-ok'),
        'ok-2':        rgb('--c-ok-2'),
        warn:          rgb('--c-warn'),
        'warn-2':      rgb('--c-warn-2'),
        danger:        rgb('--c-danger'),
        'danger-2':    rgb('--c-danger-2'),
        accent:        rgb('--c-accent'),

        // legacy aliases (kept for any lingering references)
        'ok-soft':     'rgb(var(--c-ok) / 0.10)',
        'warn-soft':   'rgb(var(--c-warn) / 0.10)',
        'danger-soft': 'rgb(var(--c-danger) / 0.10)',
        'accent-soft': 'rgb(var(--c-accent) / 0.10)',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        display: ['var(--font-geist-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      letterSpacing: {
        tightest: '-0.04em',
      },
      boxShadow: {
        'hairline':    '0 0 0 1px rgba(0,0,0,0.04)',
        'raise':       '0 1px 0 rgba(255,255,255,0.04), 0 8px 24px rgba(0,0,0,0.4)',
        'inner-hi':    'inset 0 1px 0 rgba(255,255,255,0.04)',
      },
      transitionTimingFunction: {
        'ease-out-quart': 'cubic-bezier(0.25, 1, 0.35, 1)',
        'ease-out-expo':  'cubic-bezier(0.19, 1, 0.22, 1)',
      },
      animation: {
        'row-in':      'row-in 320ms cubic-bezier(0.25, 1, 0.35, 1) both',
        'flash-ok':    'flash-ok 900ms ease-out both',
        'flash-warn':  'flash-warn 900ms ease-out both',
        'flash-danger':'flash-danger 900ms ease-out both',
        'pulse-slow':  'pulse-slow 2.2s ease-in-out infinite',
      },
      keyframes: {
        'row-in': {
          '0%':   { opacity: '0', transform: 'translateX(-4px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'flash-ok': {
          '0%':   { boxShadow: '0 0 0 1px rgb(var(--c-ok) / 0.55), 0 0 32px -6px rgb(var(--c-ok) / 0.55)' },
          '100%': { boxShadow: '0 0 0 1px rgb(var(--c-ok) / 0)' },
        },
        'flash-warn': {
          '0%':   { boxShadow: '0 0 0 1px rgb(var(--c-warn) / 0.55), 0 0 32px -6px rgb(var(--c-warn) / 0.55)' },
          '100%': { boxShadow: '0 0 0 1px rgb(var(--c-warn) / 0)' },
        },
        'flash-danger': {
          '0%':   { boxShadow: '0 0 0 1px rgb(var(--c-danger) / 0.55), 0 0 32px -6px rgb(var(--c-danger) / 0.55)' },
          '100%': { boxShadow: '0 0 0 1px rgb(var(--c-danger) / 0)' },
        },
        'pulse-slow': {
          '0%,100%': { opacity: '1' },
          '50%':     { opacity: '0.55' },
        },
      },
    },
  },
  plugins: [],
};
export default config;
