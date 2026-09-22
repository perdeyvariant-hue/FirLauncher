import { create } from 'zustand';
import type { Appearance, Settings } from '@/types/settings';
import { DEFAULT_SETTINGS } from '@/types/settings';
import * as metaApi from '@/api/meta';
import { applyLook } from '@/lib/appearance';
import { useToasts } from './useToasts';

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  saving: boolean;
  /** Release builds ship their own CurseForge key; the field is hidden then. */
  curseforgeKeyBuiltin: boolean;
  discordAppIdBuiltin: boolean;
  load: () => Promise<void>;
  patch: (patch: Partial<Settings>) => Promise<void>;
  /** Shorthand for changing a few personalisation fields. */
  patchAppearance: (patch: Partial<Appearance>) => void;
}

/** Quiet period before a settings change is written to disk. */
const SAVE_DEBOUNCE_MS = 400;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** Bumped on every edit, so a slow save cannot undo a newer one. */
let revision = 0;

export const useSettings = create<SettingsState>()((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  saving: false,
  curseforgeKeyBuiltin: false,
  discordAppIdBuiltin: false,

  load: async () => {
    try {
      const [settings, info] = await Promise.all([metaApi.loadSettings(), metaApi.buildInfo()]);
      set({
        settings,
        loaded: true,
        curseforgeKeyBuiltin: info.curseforgeKeyBuiltin,
        discordAppIdBuiltin: info.discordAppIdBuiltin,
      });
      applyLook(settings);
    } catch (raw) {
      useToasts.getState().fail(raw);
      set({ loaded: true });
    }
  },

  patch: (patch) => {
    const next: Settings = { ...get().settings, ...patch };
    // Optimistic: the theme must flip instantly, not after a round trip.
    set({ settings: next, saving: true });
    if (patch.theme !== undefined || patch.appearance !== undefined) applyLook(next);
    const mine = ++revision;

    // Sliders fire on every pixel; persist once the user stops moving.
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void metaApi
        .saveSettings(next)
        .then((saved) => {
          // The user kept editing while this was in flight; theirs wins.
          if (mine !== revision) return;
          set({ settings: saved, saving: false });
          applyLook(saved);
        })
        .catch((raw: unknown) => {
          useToasts.getState().fail(raw);
          set({ saving: false });
        });
    }, SAVE_DEBOUNCE_MS);

    return Promise.resolve();
  },

  patchAppearance: (patch) => {
    void get().patch({ appearance: { ...get().settings.appearance, ...patch } });
  },
}));
