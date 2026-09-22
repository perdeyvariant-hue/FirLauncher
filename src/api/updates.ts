import { isTauri } from '@/lib/ipc';

/** A newer launcher release found on GitHub. */
export interface AvailableUpdate {
  readonly version: string;
  readonly currentVersion: string;
  readonly notes: string | null;
  readonly date: string | null;
  /** Downloads, verifies the signature and installs; reports bytes as it goes. */
  readonly install: (onProgress: (done: number, total: number | null) => void) => Promise<void>;
}

export async function appVersion(): Promise<string> {
  if (!isTauri()) return '0.0.0-dev';
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}

/**
 * Asks the release feed for a newer version. Throws when the feed cannot be
 * reached; resolves null when this is the newest version.
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri()) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (update === null) return null;
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body ?? null,
    date: update.date ?? null,
    install: async (onProgress) => {
      let done = 0;
      let total: number | null = null;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') total = event.data.contentLength ?? null;
        if (event.event === 'Progress') done += event.data.chunkLength;
        onProgress(done, total);
      });
    },
  };
}

/** Restarts into the freshly installed version. */
export async function relaunch(): Promise<void> {
  const { relaunch: restart } = await import('@tauri-apps/plugin-process');
  await restart();
}
