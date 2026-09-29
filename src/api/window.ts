import { ipc, ipcUnit, shouldMock } from './shared';

/** Shrinks the window to the launch card and shows it. */
export function shrinkLauncher(): Promise<void> {
  if (shouldMock()) return Promise.resolve();
  return ipcUnit('shrink_launcher');
}

/** Gets out of the way while the game is running. */
export function hideLauncher(): Promise<void> {
  if (shouldMock()) return Promise.resolve();
  return ipcUnit('hide_launcher');
}

/** Steps aside without disappearing. */
export function minimizeLauncher(): Promise<void> {
  if (shouldMock()) return Promise.resolve();
  return ipcUnit('minimize_launcher');
}

/** Brings the whole launcher back at its normal size. */
export function restoreLauncher(): Promise<void> {
  if (shouldMock()) return Promise.resolve();
  return ipcUnit('restore_launcher');
}

/** Full screen and back again. */
export function toggleMaximizeLauncher(): Promise<void> {
  if (shouldMock()) return Promise.resolve();
  return ipcUnit('toggle_maximize_launcher');
}

/** Which shape the green light should draw. */
export function isLauncherMaximized(): Promise<boolean> {
  if (shouldMock()) return Promise.resolve(false);
  return ipc<boolean>('is_launcher_maximized');
}

/** Closes the launcher, cleaning up downloads and a running game. */
export function quitLauncher(): Promise<void> {
  if (shouldMock()) return Promise.resolve();
  return ipcUnit('quit_launcher');
}

/**
 * The corner radius the window itself has, so the interface can match it:
 * Windows 11 rounds the window at its own radius, Windows 10 cannot round
 * it at all (0), elsewhere the design's own radius applies.
 */
export function windowCornerRadius(): Promise<number> {
  if (shouldMock()) return Promise.resolve(24);
  return ipc<number>('window_corner_radius');
}
