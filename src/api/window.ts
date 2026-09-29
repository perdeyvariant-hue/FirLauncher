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

export interface WindowFrame {
  /** Corner radius the interface draws, px. */
  readonly radius: number;
  /** Whether the system blurs what shows through a see-through window. */
  readonly blur: boolean;
}

/** How the window frames the interface; see src-tauri/src/corners.rs. */
export function windowFrame(): Promise<WindowFrame> {
  if (shouldMock()) return Promise.resolve({ radius: 24, blur: true });
  return ipc<WindowFrame>('window_frame');
}
