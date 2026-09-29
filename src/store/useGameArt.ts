import { useEffect } from 'react';
import { create } from 'zustand';
import * as artApi from '@/api/art';
import { BLOCK_TEXTURES } from '@/lib/blocks';

interface GameArtState {
  /** Game version → texture name → data URL. Filled per version on demand. */
  textures: Record<string, Record<string, string>>;
  /** Game version → its title-screen panorama; null when there is none. */
  panoramas: Record<string, string | null>;
  /** Instance id → its newest screenshot; null when it has none. */
  covers: Record<string, string | null>;
  loadTextures: (version: string) => void;
  loadPanorama: (version: string) => void;
  loadCover: (instanceId: string) => void;
  /** Forget a cover so the next look reads the screenshots again. */
  dropCover: (instanceId: string) => void;
}

const pending = new Set<string>();

/** Runs `fetch` once per key while nothing is known for it yet. */
function once<T>(key: string, known: boolean, fetch: () => Promise<T>, store: (value: T) => void): void {
  if (known || pending.has(key)) return;
  pending.add(key);
  void fetch().then((value) => {
    pending.delete(key);
    store(value);
  });
}

/** Pictures from the player's game files, fetched once per version or instance. */
export const useGameArt = create<GameArtState>()((set, get) => ({
  textures: {},
  panoramas: {},
  covers: {},

  loadTextures: (version) => {
    once(
      `textures:${version}`,
      version in get().textures,
      () => artApi.blockTextures(version, BLOCK_TEXTURES).catch(() => ({})),
      (found) => {
        set((state) => ({ textures: { ...state.textures, [version]: found } }));
      },
    );
  },

  loadPanorama: (version) => {
    once(
      `panorama:${version}`,
      version in get().panoramas,
      () => artApi.versionPanorama(version).catch(() => null),
      (panorama) => {
        set((state) => ({ panoramas: { ...state.panoramas, [version]: panorama } }));
      },
    );
  },

  loadCover: (instanceId) => {
    once(
      `cover:${instanceId}`,
      instanceId in get().covers,
      () => artApi.instanceCover(instanceId).catch(() => null),
      (cover) => {
        set((state) => ({ covers: { ...state.covers, [instanceId]: cover } }));
      },
    );
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

/** The textures of a game version, asking for them the first time. */
export function useVersionTextures(version: string): Record<string, string> {
  const textures = useGameArt((state) => state.textures[version]);
  const load = useGameArt((state) => state.loadTextures);
  useEffect(() => {
    if (version !== '') load(version);
  }, [version, load]);
  return textures ?? EMPTY;
}

const EMPTY: Record<string, string> = {};
