import { create } from 'zustand';
import type { Instance, ModLoader } from '@/types/instance';
import type { CreateInstanceInput } from '@/api/instances';
import * as instancesApi from '@/api/instances';
import { useToasts } from './useToasts';

export type SortKey = 'lastPlayed' | 'name' | 'playtime' | 'created';

export interface InstanceFilters {
  readonly search: string;
  readonly version: string | null;
  readonly loader: ModLoader | null;
  readonly sort: SortKey;
}

interface InstancesState {
  instances: Instance[];
  loading: boolean;
  filters: InstanceFilters;
  load: () => Promise<void>;
  setFilters: (patch: Partial<InstanceFilters>) => void;
  create: (input: CreateInstanceInput) => Promise<Instance | null>;
  remove: (id: string) => Promise<void>;
  duplicate: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  save: (instance: Instance) => Promise<void>;
  launch: (id: string, accountId: string) => Promise<void>;
  /** Adds an instance created elsewhere (import, modpack install). */
  adopt: (instance: Instance) => void;
}

/** Quiet period before an instance edit is written to instance.json. */
const SAVE_DEBOUNCE_MS = 400;
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

const INITIAL_FILTERS: InstanceFilters = {
  search: '',
  version: null,
  loader: null,
  sort: 'lastPlayed',
};

export const useInstances = create<InstancesState>()((set, get) => ({
  instances: [],
  loading: false,
  filters: INITIAL_FILTERS,

  load: async () => {
    set({ loading: true });
    try {
      set({ instances: await instancesApi.listInstances(), loading: false });
    } catch (raw) {
      useToasts.getState().fail(raw, () => void get().load());
      set({ loading: false });
    }
  },

  setFilters: (patch) => {
    set((state) => ({ filters: { ...state.filters, ...patch } }));
  },

  create: async (input) => {
    try {
      const instance = await instancesApi.createInstance(input);
      set((state) => ({ instances: [instance, ...state.instances] }));
      return instance;
    } catch (raw) {
      useToasts.getState().fail(raw);
      return null;
    }
  },

  remove: async (id) => {
    const previous = get().instances;
    set({ instances: previous.filter((instance) => instance.id !== id) });
    try {
      await instancesApi.deleteInstance(id);
      useToasts.getState().notify('Сборка удалена', 'success');
    } catch (raw) {
      set({ instances: previous });
      useToasts.getState().fail(raw);
    }
  },

  duplicate: async (id) => {
    const source = get().instances.find((instance) => instance.id === id);
    if (source === undefined) return;
    try {
      const copy = await instancesApi.duplicateInstance(id, `${source.name} (копия)`);
      set((state) => ({ instances: [copy, ...state.instances] }));
    } catch (raw) {
      useToasts.getState().fail(raw);
    }
  },

  rename: async (id, name) => {
    const source = get().instances.find((instance) => instance.id === id);
    if (source === undefined) return;
    await get().save({ ...source, name });
  },

  save: (instance) => {
    const previous = get().instances;
    set({
      instances: previous.map((item) => (item.id === instance.id ? instance : item)),
    });

    // The RAM slider calls this on every step; write once it settles.
    const pending = saveTimers.get(instance.id);
    if (pending !== undefined) clearTimeout(pending);
    saveTimers.set(
      instance.id,
      setTimeout(() => {
        saveTimers.delete(instance.id);
        void instancesApi
          .updateInstance(instance)
          .then((saved) => {
            set((state) => ({
              instances: state.instances.map((item) =>
                item.id === saved.id ? saved : item,
              ),
            }));
          })
          .catch((raw: unknown) => {
            set({ instances: previous });
            useToasts.getState().fail(raw);
          });
      }, SAVE_DEBOUNCE_MS),
    );

    return Promise.resolve();
  },

  adopt: (instance) => {
    set((state) => ({
      instances: [instance, ...state.instances.filter((item) => item.id !== instance.id)],
    }));
  },

  launch: async (id, accountId) => {
    try {
      await instancesApi.launchInstance(id, accountId);
    } catch (raw) {
      useToasts.getState().fail(raw, () => void get().launch(id, accountId));
    }
  },
}));

/**
 * Pure helper, deliberately *not* a Zustand selector: it builds a new array,
 * and Zustand v5 (useSyncExternalStore) would spin forever on an unstable
 * snapshot. Components call it inside `useMemo`.
 */
export function filterInstances(
  instances: readonly Instance[],
  filters: InstanceFilters,
): Instance[] {
  const { search, version, loader, sort } = filters;
  const needle = search.trim().toLowerCase();

  const filtered = instances.filter((instance) => {
    if (needle !== '' && !instance.name.toLowerCase().includes(needle)) return false;
    if (version !== null && instance.mcVersion !== version) return false;
    if (loader !== null && instance.loader !== loader) return false;
    return true;
  });

  return filtered.sort((a, b) => {
    switch (sort) {
      case 'name':
        return a.name.localeCompare(b.name, 'ru');
      case 'playtime':
        return b.totalPlaySeconds - a.totalPlaySeconds;
      case 'created':
        return b.createdAt.localeCompare(a.createdAt);
      case 'lastPlayed':
      default:
        return (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? '');
    }
  });
}
