import { create } from 'zustand';
import type { InstanceTab, Route } from '@/types/route';

interface UIState {
  route: Route;
  /** Simple back stack — the app has no URL bar, so this is enough. */
  history: Route[];
  taskbarExpanded: boolean;
  /** Bumped when files are added from outside a tab (drag and drop), so lists reload. */
  contentRevision: number;
  bumpContent: () => void;
  navigate: (route: Route) => void;
  openInstance: (id: string, tab?: InstanceTab) => void;
  setInstanceTab: (tab: InstanceTab) => void;
  back: () => void;
  toggleTaskbar: () => void;
  setTaskbarExpanded: (value: boolean) => void;
}

export const useUI = create<UIState>()((set, get) => ({
  route: { name: 'instances' },
  history: [],
  taskbarExpanded: false,
  contentRevision: 0,

  bumpContent: () => {
    set((state) => ({ contentRevision: state.contentRevision + 1 }));
  },

  navigate: (route) => {
    set((state) => ({ route, history: [...state.history, state.route].slice(-20) }));
  },

  openInstance: (id, tab = 'overview') => {
    get().navigate({ name: 'instance', id, tab });
  },

  setInstanceTab: (tab) => {
    const { route } = get();
    if (route.name !== 'instance') return;
    set({ route: { ...route, tab } });
  },

  back: () => {
    set((state) => {
      const previous = state.history.at(-1);
      if (previous === undefined) return { route: { name: 'instances' } as Route, history: [] };
      return { route: previous, history: state.history.slice(0, -1) };
    });
  },

  toggleTaskbar: () => {
    set((state) => ({ taskbarExpanded: !state.taskbarExpanded }));
  },

  setTaskbarExpanded: (value) => {
    set({ taskbarExpanded: value });
  },
}));
