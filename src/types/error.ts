/**
 * Mirror of the Rust `LauncherError` payload. Every `invoke` rejection is
 * normalised into this shape by `lib/ipc.ts`, so the UI never renders
 * "Error: undefined".
 */
export const ERROR_KINDS = [
  'network',
  'http',
  'io',
  'hash',
  'parse',
  'auth',
  'java',
  'loader',
  'instance',
  'provider',
  'cancelled',
  'unsupported',
  'internal',
] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];

export interface LauncherError {
  readonly kind: ErrorKind;
  /** Short, human-readable, already localised for the UI. */
  readonly message: string;
  /** Optional technical detail — shown in a collapsible block. */
  readonly detail?: string;
  /** Whether offering a "Retry" button makes sense. */
  readonly retryable: boolean;
}

export function isLauncherError(value: unknown): value is LauncherError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['kind'] === 'string' &&
    (ERROR_KINDS as readonly string[]).includes(candidate['kind']) &&
    typeof candidate['message'] === 'string' &&
    typeof candidate['retryable'] === 'boolean'
  );
}
