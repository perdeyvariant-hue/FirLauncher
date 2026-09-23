import { ipcUnit, shouldMock } from './shared';

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

/** Closes the launcher, cleaning up downloads and a running game. */
export function quitLauncher(): Promise<void> {
  if (shouldMock()) return Promise.resolve();
  return ipcUnit('quit_launcher');
}
