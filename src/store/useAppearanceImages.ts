import { create } from 'zustand';
import * as appearanceApi from '@/api/appearance';
import type { CustomMascot } from '@/api/appearance';
import { useToasts } from './useToasts';

interface AppearanceImagesState {
  /** `data:` URL of the user's own wallpaper, once loaded. */
  wallpaper: string | null;
  /** The user's own mascot pictures, oldest first. */
  mascots: CustomMascot[];
  /** The skin figure and which account+skin it shows; refetched on change. */
  figure: { readonly key: string; readonly url: string | null } | null;
  load: () => Promise<void>;
  /** Asks for a file and makes it the wallpaper. True when one was set. */
  chooseWallpaper: () => Promise<boolean>;
  clearWallpaper: () => Promise<void>;
  /** Asks for a file and adds it to the mascots; returns the new entry. */
  addMascot: () => Promise<CustomMascot | null>;
  removeMascot: (id: string) => Promise<void>;
  loadFigure: (accountId: string, skinUrl: string | null) => Promise<void>;
}

export const useAppearanceImages = create<AppearanceImagesState>()((set, get) => ({
  wallpaper: null,
  mascots: [],
  figure: null,

  load: async () => {
    try {
      const [wallpaper, mascots] = await Promise.all([
        appearanceApi.appearanceImage('wallpaper'),
        appearanceApi.listCustomMascots(),
      ]);
      set({ wallpaper, mascots });
    } catch {
      // A broken picture must not stop the launcher; the default look stays.
    }
  },

  chooseWallpaper: async () => {
    try {
      const path = await appearanceApi.pickImage();
      if (path === null) return false;
      set({ wallpaper: await appearanceApi.setAppearanceImage('wallpaper', path) });
      return true;
    } catch (raw) {
      useToasts.getState().fail(raw);
      return false;
    }
  },

  clearWallpaper: async () => {
    set({ wallpaper: null });
    try {
      await appearanceApi.clearAppearanceImage('wallpaper');
    } catch (raw) {
      useToasts.getState().fail(raw);
    }
  },

  addMascot: async () => {
    try {
      const path = await appearanceApi.pickImage();
      if (path === null) return null;
      const added = await appearanceApi.addCustomMascot(path);
      set((state) => ({ mascots: [...state.mascots, added] }));
      return added;
    } catch (raw) {
      useToasts.getState().fail(raw);
      return null;
    }
  },

  removeMascot: async (id) => {
    const previous = get().mascots;
    set({ mascots: previous.filter((mascot) => mascot.id !== id) });
    try {
      await appearanceApi.removeCustomMascot(id);
    } catch (raw) {
      set({ mascots: previous });
      useToasts.getState().fail(raw);
    }
  },

  loadFigure: async (accountId, skinUrl) => {
    const key = `${accountId}|${skinUrl ?? ''}`;
    if (get().figure?.key === key) return;
    set({ figure: { key, url: null } });
    if (skinUrl === null) return;
    try {
      const url = await appearanceApi.accountFigure(accountId);
      // Only if the account did not change while the skin was downloading.
      if (get().figure?.key === key) set({ figure: { key, url } });
    } catch {
      // No skin, no figure: the corner stays empty.
    }
  },
}));
