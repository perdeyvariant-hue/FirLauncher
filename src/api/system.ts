import { ipc, isTauri, mocked, shouldMock } from './shared';

/** Opens a link in the user's default browser, never inside the launcher. */
export async function openExternal(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
}

/** Publishes a log on mclo.gs (personal paths and tokens removed first). */
export async function shareLog(lines: readonly string[]): Promise<string> {
  if (shouldMock()) return mocked('https://mclo.gs/example', 600);
  const shared = await ipc<{ url: string }>('share_log', { lines });
  return shared.url;
}
