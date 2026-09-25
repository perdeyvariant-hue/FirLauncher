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
        accent: withAlpha('--accent-rgb'),
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
        sm: 'calc(var(--radius) * 0.6)',
        md: 'calc(var(--radius) * 0.8)',
        lg: 'var(--radius)',
        xl: 'calc(var(--radius) * 1.4)',
        '2xl': 'calc(var(--radius) * 1.8)',
        pill: '999px',
      },
      boxShadow: {
        glass: 'var(--glass-rim), var(--glass-cast)',
        'glass-sm': 'var(--glass-rim), var(--glass-cast-sm)',
        rim: 'var(--glass-rim)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['11px', { lineHeight: '16px' }],
      },
      transitionDuration: {
        DEFAULT: '160ms',
        fast: '120ms',
        slow: '260ms',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.16, 1, 0.3, 1)',
        // Overshoots a little on the way out, the way a soft body settles.
        spring: 'cubic-bezier(0.32, 1.35, 0.4, 1)',
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
      },
      animation: {
        'fade-in': 'fade-in 140ms cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-out': 'fade-out 120ms cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scale-in 160ms cubic-bezier(0.16, 1, 0.3, 1)',
        'glass-in': 'glass-in 260ms cubic-bezier(0.32, 1.35, 0.4, 1)',
        sheen: 'sheen 900ms cubic-bezier(0.4, 0, 0.2, 1)',
        'slide-up': 'slide-up 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-down': 'slide-down 160ms cubic-bezier(0.16, 1, 0.3, 1)',
        indeterminate: 'indeterminate 1.1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin-slow 900ms linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
