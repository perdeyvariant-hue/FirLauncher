import { create } from 'zustand';
import type { Instance } from '@/types/instance';
import type { ImportResult, SkippedFile } from '@/types/pack';
import { useInstances } from './useInstances';
import { useToasts } from './useToasts';
import { useUI } from './useUI';

interface PacksState {
  /** Instance the export dialog is open for. */
  exportTarget: Instance | null;
  /** Files an import could not fetch, shown once after it finishes. */
  skipped: readonly SkippedFile[] | null;
  openExport: (instance: Instance) => void;
  closeExport: () => void;
  closeSkipped: () => void;
  /** Common ending for every import: adopt, open it, report leftovers. */
  finishImport: (result: ImportResult) => void;
}

export const usePacks = create<PacksState>()((set) => ({
  exportTarget: null,
  skipped: null,

  openExport: (instance) => {
    set({ exportTarget: instance });
  },
  closeExport: () => {
    set({ exportTarget: null });
  },
  closeSkipped: () => {
    set({ skipped: null });
  },

  finishImport: (result) => {
    useInstances.getState().adopt(result.instance);
    useUI.getState().openInstance(result.instance.id);
    useToasts.getState().notify(`Сборка «${result.instance.name}» готова`, 'success');
    if (result.skipped.length > 0) set({ skipped: result.skipped });
  },
}));
