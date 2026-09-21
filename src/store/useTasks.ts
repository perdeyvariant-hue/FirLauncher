import { create } from 'zustand';
import type { Task } from '@/types/task';
import * as tasksApi from '@/api/tasks';
import { onEvent } from '@/lib/events';
import { useToasts } from './useToasts';

interface TasksState {
  tasks: Task[];
  load: () => Promise<void>;
  /** Subscribes to backend progress events; returns an unsubscribe function. */
  subscribe: () => Promise<() => void>;
  upsert: (task: Task) => void;
  cancel: (id: string) => Promise<void>;
  clearFinished: () => void;
}

const ACTIVE_STATES = new Set<Task['state']>(['queued', 'running', 'paused']);

export const useTasks = create<TasksState>()((set, get) => ({
  tasks: [],

  load: async () => {
    try {
      set({ tasks: await tasksApi.listTasks() });
    } catch (raw) {
      useToasts.getState().fail(raw);
    }
  },

  subscribe: async () => {
    const unlistenUpdate = await onEvent('task://update', (task) => {
      get().upsert(task);
    });
    const unlistenFinished = await onEvent('task://finished', (task) => {
      get().upsert(task);
      if (task.state === 'failed' && task.error !== null) {
        useToasts.getState().push({
          tone: 'error',
          title: `${task.title}: не удалось`,
          detail: task.error,
          onRetry: () => void tasksApi.retryTask(task.id),
        });
      }
    });
    return () => {
      unlistenUpdate();
      unlistenFinished();
    };
  },

  upsert: (task) => {
    set((state) => {
      const index = state.tasks.findIndex((item) => item.id === task.id);
      if (index === -1) return { tasks: [...state.tasks, task] };
      const tasks = [...state.tasks];
      tasks[index] = task;
      return { tasks };
    });
  },

  cancel: async (id) => {
    try {
      await tasksApi.cancelTask(id);
    } catch (raw) {
      useToasts.getState().fail(raw);
    }
  },

  clearFinished: () => {
    set((state) => ({ tasks: state.tasks.filter((task) => ACTIVE_STATES.has(task.state)) }));
  },
}));

/**
 * Pure helper rather than a Zustand selector — it returns a fresh array, which
 * would make `useSyncExternalStore` loop. Components wrap it in `useMemo`.
 */
export function activeTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter((task) => ACTIVE_STATES.has(task.state));
}

/** Combined 0..1 progress of all active tasks, or null when nothing is measurable. */
export function overallProgress(tasks: readonly Task[]): number | null {
  const active = activeTasks(tasks);
  const measurable = active.filter((task) => task.progress !== null);
  if (measurable.length === 0) return null;
  const sum = measurable.reduce((acc, task) => acc + (task.progress ?? 0), 0);
  return sum / measurable.length;
}
