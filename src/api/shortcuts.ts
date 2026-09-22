import { ipc, mocked, shouldMock } from './shared';
import { t } from '@/lib/i18n';

/** Puts a shortcut on the desktop that starts the instance; resolves with its path. */
export function createDesktopShortcut(id: string): Promise<string> {
  if (shouldMock()) return mocked(t`Desktop/Сборка — FirLauncher.lnk`, 300);
  return ipc<string>('create_desktop_shortcut', { id });
}

/** The instance the launcher was started for from a shortcut, once. */
export function takeStartupLaunch(): Promise<string | null> {
  if (shouldMock()) return mocked<string | null>(null, 10);
  return ipc<string | null>('take_startup_launch');
}
