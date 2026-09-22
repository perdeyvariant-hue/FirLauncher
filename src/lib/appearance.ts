import { accentPalette, parseHex, toChannels } from '@/lib/color';
import { isTauri } from '@/lib/ipc';
import type { Appearance, Settings, ThemeMode } from '@/types/settings';
import { DEFAULT_APPEARANCE } from '@/types/settings';

/**
 * Applies theme and personalisation to <html>: `data-theme`, the accent
 * trio, text-on-accent, corner radius, glass panels, reduced motion and the
 * webview zoom. Everything else in the UI reads these tokens, so nothing
 * needs to re-render.
 */

export type ResolvedTheme = 'dark' | 'light';

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode !== 'system') return mode;
  const prefersLight =
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches;
  return prefersLight ? 'light' : 'dark';
}

const ACCENT_VARS = ['--accent-rgb', '--accent-hover-rgb', '--accent-dim-rgb', '--on-accent-rgb'];

function applyAccent(root: HTMLElement, hex: string, theme: ResolvedTheme): void {
  const base = parseHex(hex);
  // The stock purple keeps its hand-tuned shades from tokens.css.
  if (base === null || hex.toUpperCase() === DEFAULT_APPEARANCE.accent) {
    for (const name of ACCENT_VARS) root.style.removeProperty(name);
    return;
  }
  const palette = accentPalette(base, theme);
  root.style.setProperty('--accent-rgb', toChannels(palette.accent));
  root.style.setProperty('--accent-hover-rgb', toChannels(palette.hover));
  root.style.setProperty('--accent-dim-rgb', toChannels(palette.dim));
  root.style.setProperty('--on-accent-rgb', toChannels(palette.onAccent));
}

let appliedZoom = 1;

/**
 * Interface scale is the webview's own zoom, like Ctrl + in a browser: CSS
 * `zoom` on the page would fight the full-height layout.
 */
function applyZoom(percent: number): void {
  const zoom = Math.min(130, Math.max(80, percent)) / 100;
  if (zoom === appliedZoom || !isTauri()) return;
  appliedZoom = zoom;
  void import('@tauri-apps/api/webview')
    .then(({ getCurrentWebview }) => getCurrentWebview().setZoom(zoom))
    .catch(() => {
      // An older webview without zoom support keeps 100%; nothing breaks.
    });
}

export function applyAppearance(appearance: Appearance, theme: ResolvedTheme): void {
  const root = document.documentElement;
  applyAccent(root, appearance.accent, theme);
  root.style.setProperty('--radius', `${String(Math.min(16, Math.max(0, appearance.radius)))}px`);
  root.classList.toggle('reduce-motion', appearance.reduceMotion);
  // Glass only makes sense with something behind the panels.
  root.dataset['glass'] = appearance.glassPanels && appearance.wallpaper !== 'none' ? 'on' : 'off';
  applyZoom(appearance.uiScale);
}

let listening = false;
let current: Settings | null = null;

/** Theme plus personalisation; follows the OS theme while in "system". */
export function applyLook(settings: Settings): void {
  current = settings;
  const theme = resolveTheme(settings.theme);
  document.documentElement.dataset['theme'] = theme;
  applyAppearance(settings.appearance, theme);

  if (!listening && typeof window !== 'undefined') {
    listening = true;
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (current?.theme === 'system') applyLook(current);
    });
  }
}
