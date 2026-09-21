/**
 * The seam between the UI and the backend.
 *
 * Each `api/*` module exposes domain functions that call `ipc()` for real and
 * fall back to `src/mocks` otherwise. Stages 2–6 replace the mock branch one
 * command at a time; no component ever imports a mock directly.
 */
import { isTauri } from '@/lib/ipc';

export { isTauri, ipc, ipcUnit } from '@/lib/ipc';

/**
 * Since stage 2 the Rust side answers for real, so fixtures are only used in a
 * plain browser tab, where there is no webview to talk to. Flip this to `true`
 * to work on the UI against fixtures inside the app window.
 */
const FORCE_MOCKS: boolean = false;

/** Named `shouldMock`, not `useMocks` — it is not a React hook. */
export function shouldMock(): boolean {
  if (FORCE_MOCKS) return true;
  return !isTauri();
}

/** Simulates backend latency so loading states are actually exercised. */
export function mocked<T>(value: T, ms = 220): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(value);
    }, ms);
  });
}
