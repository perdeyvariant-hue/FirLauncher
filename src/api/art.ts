import { ipc, mocked, shouldMock } from './shared';

/**
 * Game pictures for covers, read from the player's downloaded game files.
 * The browser preview has none of those; a page may hand some in through
 * `window.__FIR_DEV_ART__` to look at covers there.
 */
interface DevArt {
  readonly blocks?: Record<string, string>;
  readonly panoramas?: string[];
  readonly covers?: Record<string, string>;
}

function devArt(): DevArt {
  return (window as unknown as { __FIR_DEV_ART__?: DevArt }).__FIR_DEV_ART__ ?? {};
}

export function blockTextures(names: readonly string[]): Promise<Record<string, string>> {
  if (shouldMock()) {
    const all = devArt().blocks ?? {};
    return mocked(Object.fromEntries(names.flatMap((name) => (name in all ? [[name, all[name] ?? '']] : []))));
  }
  return ipc<Record<string, string>>('block_textures', { names });
}

export function gamePanoramas(): Promise<string[]> {
  if (shouldMock()) return mocked(devArt().panoramas ?? []);
  return ipc<string[]>('game_panoramas');
}

/** The instance's newest screenshot as a cover, or null without screenshots. */
export function instanceCover(id: string): Promise<string | null> {
  if (shouldMock()) return mocked(devArt().covers?.[id] ?? null);
  return ipc<string | null>('instance_cover', { id });
}
