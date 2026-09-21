import { create } from 'zustand';
import type { LauncherError } from '@/types/error';
import { toLauncherError } from '@/lib/ipc';

export type ToastTone = 'info' | 'success' | 'error';

export interface Toast {
  readonly id: string;
  readonly tone: ToastTone;
  readonly title: string;
  readonly detail: string | null;
  /** Present on error toasts that the backend marked as retryable. */
  readonly onRetry: (() => void) | null;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'>) => string;
  notify: (title: string, tone?: ToastTone) => void;
  /** Normalises anything thrown by the api layer into a readable toast. */
  fail: (raw: unknown, onRetry?: () => void) => LauncherError;
  dismiss: (id: string) => void;
}

const AUTO_DISMISS_MS = 6000;
let counter = 0;

export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],

  push: (toast) => {
    counter += 1;
    const id = `toast-${String(counter)}`;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    if (toast.tone !== 'error') {
      setTimeout(() => {
        get().dismiss(id);
      }, AUTO_DISMISS_MS);
    }
    return id;
  },

  notify: (title, tone = 'info') => {
    get().push({ tone, title, detail: null, onRetry: null });
  },

  fail: (raw, onRetry) => {
    const error = toLauncherError(raw);
    get().push({
      tone: 'error',
      title: error.message,
      detail: error.detail ?? null,
      onRetry: error.retryable && onRetry !== undefined ? onRetry : null,
    });
    return error;
  },

  dismiss: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },
}));
