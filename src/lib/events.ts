import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import type { Task } from '@/types/task';
import type { LogStream } from '@/types/instance';
import type { DeviceCodeState } from '@/types/account';
import { isTauri } from './ipc';

/** Event name → payload. Kept in sync with `src-tauri/src/tasks/progress.rs`. */
export interface LauncherEvents {
  'task://update': Task;
  'task://finished': Task;
  'game://log': { instanceId: string; stream: LogStream; line: string };
  'game://exit': {
    instanceId: string;
    exitCode: number;
    crashed: boolean;
    playedSeconds: number;
  };
  'auth://device-code': DeviceCodeState;
  /** A background refresh renamed, re-skinned or expired an account. */
  'accounts://changed': null;
}

export type LauncherEventName = keyof LauncherEvents;

const noopUnlisten: UnlistenFn = () => undefined;

/**
 * Typed wrapper over Tauri's `listen`. Outside the webview it resolves to a
 * no-op so components can subscribe unconditionally.
 */
export async function onEvent<K extends LauncherEventName>(
  name: K,
  handler: (payload: LauncherEvents[K]) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return noopUnlisten;
  return listen<LauncherEvents[K]>(name, (event) => {
    handler(event.payload);
  });
}
