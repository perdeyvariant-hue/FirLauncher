import type { Task } from '@/types/task';
import { MOCK_TASKS } from '@/mocks/data';
import { ipc, ipcUnit, mocked, shouldMock } from './shared';

export function listTasks(): Promise<Task[]> {
  if (shouldMock()) return mocked([...MOCK_TASKS], 80);
  return ipc<Task[]>('list_tasks');
}

export function cancelTask(id: string): Promise<void> {
  if (shouldMock()) return mocked(undefined, 80);
  return ipcUnit('cancel_task', { id });
}

export function retryTask(id: string): Promise<void> {
  if (shouldMock()) return mocked(undefined, 80);
  return ipcUnit('retry_task', { id });
}
