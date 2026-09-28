import { create } from 'zustand';
import * as artApi from '@/api/art';
import { BLOCK_TEXTURES } from '@/lib/blocks';

interface GameArtState {
  /** Texture name → data URL. Empty until loaded or without a downloaded client. */
  textures: Record<string, string>;
  panoramas: string[];
  /** Instance id → its newest screenshot; null when it has none. */
  covers: Record<string, string | null>;
  loaded: boolean;
  load: () => Promise<void>;
  loadCover: (instanceId: string) => void;
  /** Forget a cover so the next look reads the screenshots again. */
  dropCover: (instanceId: string) => void;
}

const pendingCovers = new Set<string>();

/** Pictures from the player's game files, fetched once per session. */
export const useGameArt = create<GameArtState>()((set, get) => ({
  textures: {},
  panoramas: [],
  covers: {},
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    set({ loaded: true });
    const [textures, panoramas] = await Promise.all([
      artApi.blockTextures(BLOCK_TEXTURES).catch(() => ({})),
      artApi.gamePanoramas().catch(() => []),
    ]);
    set({ textures, panoramas });
  },

  loadCover: (instanceId) => {
    if (instanceId in get().covers || pendingCovers.has(instanceId)) return;
    pendingCovers.add(instanceId);
    void artApi
      .instanceCover(instanceId)
      .catch(() => null)
      .then((cover) => {
        pendingCovers.delete(instanceId);
        set((state) => ({ covers: { ...state.covers, [instanceId]: cover } }));
      });
  },

  dropCover: (instanceId) => {
    set((state) => {
      const covers = { ...state.covers };
      // Deleting a key the store owns; the object is a fresh copy.
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete covers[instanceId];
      return { covers };
    });
  },
}));
