import { create } from 'zustand';
import type { Settings, ThemeMode } from '@/types/settings';
import { DEFAULT_SETTINGS } from '@/types/settings';
import * as metaApi from '@/api/meta';
import { useToasts } from './useToasts';

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  saving: boolean;
  /** Release builds ship their own CurseForge key; the field is hidden then. */
  curseforgeKeyBuiltin: boolean;
  load: () => Promise<void>;
  patch: (patch: Partial<Settings>) => Promise<void>;
}

/** Quiet period before a settings change is written to disk. */
const SAVE_DEBOUNCE_MS = 400;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function applyTheme(mode: ThemeMode): void {
  const prefersLight =
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches;
  const resolved = mode === 'system' ? (prefersLight ? 'light' : 'dark') : mode;
  document.documentElement.dataset['theme'] = resolved;
}

export const useSettings = create<SettingsState>()((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  saving: false,
  curseforgeKeyBuiltin: false,

  load: async () => {
    try {
      const [settings, info] = await Promise.all([metaApi.loadSettings(), metaApi.buildInfo()]);
      set({ settings, loaded: true, curseforgeKeyBuiltin: info.curseforgeKeyBuiltin });
      applyTheme(settings.theme);
    } catch (raw) {
      useToasts.getState().fail(raw);
      set({ loaded: true });
    }
  },

  patch: (patch) => {
    const next: Settings = { ...get().settings, ...patch };
    // Optimistic: the theme must flip instantly, not after a round trip.
    set({ settings: next, saving: true });
    if (patch.theme !== undefined) applyTheme(patch.theme);

    // Sliders fire on every pixel; persist once the user stops moving.
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void metaApi
        .saveSettings(next)
        .then((saved) => {
          set({ settings: saved, saving: false });
        })
        .catch((raw: unknown) => {
          useToasts.getState().fail(raw);
          set({ saving: false });
        });
    }, SAVE_DEBOUNCE_MS);

    return Promise.resolve();
  },
}));
