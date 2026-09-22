import { create } from 'zustand';
import * as updatesApi from '@/api/updates';
import type { AvailableUpdate } from '@/api/updates';
import { useToasts } from './useToasts';
import { t } from '@/lib/i18n';

type Phase = 'idle' | 'checking' | 'available' | 'downloading' | 'failed';

interface UpdaterState {
  phase: Phase;
  update: AvailableUpdate | null;
  /** 0…1 while downloading, null when the size is unknown. */
  progress: number | null;
  /** Hidden until the next start. */
  dismissed: boolean;
  /** `quiet` checks (on start) say nothing when there is no update or no network. */
  check: (quiet: boolean) => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
}

export const useUpdater = create<UpdaterState>()((set, get) => ({
  phase: 'idle',
  update: null,
  progress: null,
  dismissed: false,

  check: async (quiet) => {
    if (get().phase === 'checking' || get().phase === 'downloading') return;
    set({ phase: 'checking' });
    try {
      const update = await updatesApi.checkForUpdate();
      set({ update, phase: update === null ? 'idle' : 'available', dismissed: false });
      if (update === null && !quiet) {
        useToasts.getState().notify(t`У вас последняя версия FirLauncher`, 'success');
      }
    } catch (raw) {
      set({ phase: 'idle' });
      if (!quiet) {
        useToasts.getState().notify(
          t`Не удалось проверить обновления: ${raw instanceof Error ? raw.message : String(raw)}`,
          'error',
        );
      }
    }
  },

  install: async () => {
    const update = get().update;
    if (update === null) return;
    set({ phase: 'downloading', progress: 0 });
    try {
      await update.install((done, total) => {
        set({ progress: total === null || total === 0 ? null : done / total });
      });
      await updatesApi.relaunch();
    } catch (raw) {
      set({ phase: 'failed' });
      useToasts
        .getState()
        .notify(t`Обновление не установилось: ${raw instanceof Error ? raw.message : String(raw)}`, 'error');
    }
  },

  dismiss: () => {
    set({ dismissed: true });
  },
}));
