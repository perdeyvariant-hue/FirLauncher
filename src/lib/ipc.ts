import { invoke } from '@tauri-apps/api/core';
import type { ErrorKind, LauncherError } from '@/types/error';
import { isLauncherError } from '@/types/error';
import { t, translate } from '@/lib/i18n';

/**
 * True when running inside the Tauri webview. In a plain `vite dev` browser
 * tab this is false and callers fall back to the mock layer, which keeps the
 * UI workable without a compiled Rust backend.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * The throwable form of `LauncherError`. It is a real `Error` so stack traces
 * and `instanceof` work, while still carrying the structured fields the UI
 * renders.
 */
export class LauncherFailure extends Error implements LauncherError {
  readonly kind: ErrorKind;
  readonly detail?: string;
  readonly retryable: boolean;

  constructor(error: LauncherError) {
    super(error.message);
    this.name = 'LauncherFailure';
    this.kind = error.kind;
    this.retryable = error.retryable;
    if (error.detail !== undefined) this.detail = error.detail;
  }
}

function safeStringify(value: unknown): string | undefined {
  try {
    // Lib types say `string`, but JSON.stringify really returns undefined for
    // undefined / functions / symbols — hence the wider return type.
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

/**
 * Turns anything a rejected `invoke` can throw into a `LauncherError`.
 * This is the single place that guarantees the UI never shows
 * "Error: undefined".
 */
export function toLauncherError(raw: unknown): LauncherError {
  // Backend messages are Russian; show them in the interface language.
  if (isLauncherError(raw)) return { ...raw, message: translate(raw.message) };

  if (raw instanceof Error) {
    return {
      kind: 'internal',
      message: raw.message === '' ? t`Неизвестная ошибка` : raw.message,
      detail: raw.stack,
      retryable: false,
    };
  }

  if (typeof raw === 'string' && raw.trim() !== '') {
    return { kind: 'internal', message: raw, retryable: false };
  }

  return {
    kind: 'internal',
    message: t`Неизвестная ошибка`,
    detail: safeStringify(raw),
    retryable: false,
  };
}

/**
 * Typed `invoke`. The generic is the command's success payload; failures are
 * always rejected as `LauncherFailure`.
 */
export async function ipc<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    throw new LauncherFailure(toLauncherError(raw));
  }
}

/** `ipc` for commands whose Rust signature returns `()`. */
export async function ipcUnit(command: string, args?: Record<string, unknown>): Promise<void> {
  await ipc<unknown>(command, args);
}

/** Formats a `LauncherError` for a toast / inline error block. */
export function describeError(error: LauncherError): string {
  return error.detail === undefined ? error.message : `${error.message}\n${error.detail}`;
}
