import { ipc, mocked, shouldMock } from './shared';

/**
 * Game pictures for covers, read from the player's game files (and, for a
 * version's panorama, fetched from Mojang's asset store like a launch
 * would). The browser preview has none of those; a page may hand some in
 * through `window.__FIR_DEV_ART__` to look at covers there.
 */
interface DevArt {
  readonly blocks?: Record<string, string>;
  readonly panoramas?: Record<string, string>;
  readonly covers?: Record<string, string>;
}

function devArt(): DevArt {
  return (window as unknown as { __FIR_DEV_ART__?: DevArt }).__FIR_DEV_ART__ ?? {};
}

/** Textures by name, from `version`'s client when it is downloaded. */
export function blockTextures(
  version: string | null,
  names: readonly string[],
): Promise<Record<string, string>> {
  if (shouldMock()) {
    const all = devArt().blocks ?? {};
    return mocked(Object.fromEntries(names.flatMap((name) => (name in all ? [[name, all[name] ?? '']] : []))));
  }
  return ipc<Record<string, string>>('block_textures', { version, names });
}

/** The title-screen panorama of a game version, or null when there is none to get. */
export function versionPanorama(version: string): Promise<string | null> {
  if (shouldMock()) return mocked(devArt().panoramas?.[version] ?? null);
  return ipc<string | null>('version_panorama', { version });
}

/** The instance's newest screenshot as a cover, or null without screenshots. */
export function instanceCover(id: string): Promise<string | null> {
  if (shouldMock()) return mocked(devArt().covers?.[id] ?? null);
  return ipc<string | null>('instance_cover', { id });
}
