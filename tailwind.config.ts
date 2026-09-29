import type { Config } from 'tailwindcss';

/**
 * Every colour is a CSS variable so the light theme is a single
 * `data-theme` swap on <html> — no duplicated Tailwind palettes.
 * See src/styles/tokens.css for the values.
 */

/**
 * Tokens are stored as raw RGB channels so Tailwind's opacity modifier
 * (`bg-accent/10`) keeps working through the variable indirection —
 * `<alpha-value>` is substituted by Tailwind at build time.
 */
const withAlpha = (variable: string): string => `rgb(var(${variable}) / <alpha-value>)`;
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: withAlpha('--bg-rgb'),
        surface: withAlpha('--surface-rgb'),
        'surface-2': withAlpha('--surface-2-rgb'),
        border: withAlpha('--border-rgb'),
        text: withAlpha('--text-rgb'),
        'text-dim': withAlpha('--text-dim-rgb'),
        'text-faint': withAlpha('--text-faint-rgb'),
        accent: withAlpha('--accent-rgb'),
        'accent-2': withAlpha('--accent-2-rgb'),
        'accent-3': withAlpha('--accent-3-rgb'),
        success: withAlpha('--success-rgb'),
        'accent-hover': withAlpha('--accent-hover-rgb'),
        'accent-dim': withAlpha('--accent-dim-rgb'),
        danger: withAlpha('--danger-rgb'),
        /** Text on an accent fill: dark on light accents, white otherwise. */
        'on-accent': withAlpha('--on-accent-rgb'),
      },
      // Driven by --radius so the roundness setting reshapes everything.
      // Controls are capsules instead: a pill is part of the material, not
      // a matter of taste.
      borderRadius: {
        DEFAULT: 'var(--radius)',
        sm: 'calc(var(--radius) * 0.5)',
        md: 'calc(var(--radius) * 0.6)',
        lg: 'calc(var(--radius) * 0.8)',
        xl: 'var(--radius)',
        '2xl': 'calc(var(--radius) * 1.4)',
        pill: '999px',
      },
      boxShadow: {
        glass: 'inset 0 0 0 1px var(--glass-border), var(--glass-shadow)',
        sheet: 'inset 0 0 0 1px var(--glass-border), var(--sheet-shadow)',
        rim: 'inset 0 0 0 1px var(--glass-border)',
      },
      fontFamily: {
        // SF on a Mac, the bundled Inter everywhere else.
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['11px', { lineHeight: '16px' }],
      },
      transitionDuration: {
        DEFAULT: '200ms',
        fast: '140ms',
        slow: '340ms',
        spring: '450ms',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.16, 1, 0.3, 1)',
        // Overshoots a little on the way out, the way a soft body settles.
        spring: 'var(--ease-spring)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'fade-out': {
          from: { opacity: '1' },
          to: { opacity: '0' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        // Glass arrives out of focus and settles, like a lens coming to rest.
        'glass-in': {
          from: { opacity: '0', transform: 'scale(0.94) translateY(8px)', filter: 'blur(6px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)', filter: 'blur(0)' },
        },
        // One pass of light across a surface, for the launch button.
        sheen: {
          from: { transform: 'translateX(-120%) skewX(-18deg)' },
          to: { transform: 'translateX(320%) skewX(-18deg)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-down': {
          from: { opacity: '0', transform: 'translateY(-6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'indeterminate': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(300%)' },
        },
        'spin-slow': {
          to: { transform: 'rotate(360deg)' },
        },
        // Light running along a progress bar.
        shimmer: {
          from: { transform: 'translateX(-120%)' },
          to: { transform: 'translateX(340%)' },
        },
        // A ring spreading out of a status dot.
        'pulse-ring': {
          from: { transform: 'scale(1)', opacity: '0.75' },
          to: { transform: 'scale(2.8)', opacity: '0' },
        },
        // The corner mascot, drawing breath.
        breathe: {
          from: { transform: 'translateY(0) rotate(-1.2deg)' },
          to: { transform: 'translateY(-7px) rotate(1.2deg)' },
        },
        'sheet-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 140ms cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-out': 'fade-out 120ms cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scale-in 160ms cubic-bezier(0.16, 1, 0.3, 1)',
        'glass-in': 'sheet-in 420ms var(--ease-spring)',
        sheen: 'sheen 900ms cubic-bezier(0.4, 0, 0.2, 1)',
        'slide-up': 'slide-up 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-down': 'slide-down 160ms cubic-bezier(0.16, 1, 0.3, 1)',
        indeterminate: 'indeterminate 1.1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin-slow 900ms linear infinite',
        iri: 'spin-slow 7s linear infinite',
        shimmer: 'shimmer 1.7s ease-in-out infinite',
        'pulse-ring': 'pulse-ring 1.6s ease-out infinite',
        breathe: 'breathe 6.5s ease-in-out infinite alternate',
        'sheet-in': 'sheet-in 420ms var(--ease-spring)',
      },
    },
  },
  plugins: [],
};

export default config;
