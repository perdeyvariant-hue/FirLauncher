import { create } from 'zustand';
import * as crashApi from '@/api/crash';
import type { CrashAnalysis, CrashFix } from '@/types/crash';
import { useToasts } from './useToasts';
import { translate } from '@/lib/i18n';

interface CrashState {
  /** The instance whose crash is being shown. */
  instanceId: string | null;
  analysis: CrashAnalysis | null;
  loading: boolean;
  /** Indexes of diagnoses whose fix was applied. */
  applied: ReadonlySet<number>;
  working: number | null;
  open: (instanceId: string) => Promise<void>;
  close: () => void;
  apply: (index: number, fix: CrashFix) => Promise<void>;
}

export const useCrash = create<CrashState>()((set, get) => ({
  instanceId: null,
  analysis: null,
  loading: false,
  applied: new Set(),
  working: null,

  open: async (instanceId) => {
    set({ instanceId, analysis: null, loading: true, applied: new Set(), working: null });
    try {
      const raw = await crashApi.diagnoseCrash(instanceId);
      // Diagnoses are written by the backend in Russian.
      const analysis = {
        ...raw,
        diagnoses: raw.diagnoses.map((diagnosis) => ({
          ...diagnosis,
          title: translate(diagnosis.title),
          explanation: translate(diagnosis.explanation),
        })),
      };
      if (get().instanceId === instanceId) set({ analysis, loading: false });
    } catch (raw) {
      set({ instanceId: null, loading: false });
      useToasts.getState().fail(raw);
    }
  },

  close: () => {
    set({ instanceId: null, analysis: null, loading: false });
  },

  apply: async (index, fix) => {
    const instanceId = get().instanceId;
    if (instanceId === null) return;
    set({ working: index });
    try {
      const message = await crashApi.applyCrashFix(instanceId, fix);
      set((state) => ({ applied: new Set([...state.applied, index]) }));
      useToasts.getState().notify(translate(message), 'success');
    } catch (raw) {
      useToasts.getState().fail(raw);
    }
    set({ working: null });
  },
}));
