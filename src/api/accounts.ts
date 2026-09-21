import type { Account } from '@/types/account';
import { MOCK_ACCOUNTS } from '@/mocks/data';
import { ipc, ipcUnit, mocked, shouldMock } from './shared';

export function listAccounts(): Promise<Account[]> {
  if (shouldMock()) return mocked([...MOCK_ACCOUNTS]);
  return ipc<Account[]>('list_accounts');
}

/** Starts the device-code flow; progress arrives via the `auth://device-code` event. */
export function beginMicrosoftLogin(): Promise<void> {
  // The flow is driven by backend events, which a plain browser tab never gets.
  if (shouldMock()) {
    return Promise.reject(new Error('Вход через Microsoft доступен только в приложении'));
  }
  return ipcUnit('begin_microsoft_login');
}

export function cancelMicrosoftLogin(): Promise<void> {
  if (shouldMock()) return mocked(undefined, 0);
  return ipcUnit('cancel_microsoft_login');
}

export function addOfflineAccount(username: string): Promise<Account> {
  if (shouldMock()) {
    return mocked<Account>({
      id: `acc-${String(Date.now())}`,
      kind: 'offline',
      username,
      uuid: '00000000-0000-3000-8000-000000000002',
      avatarUrl: null,
      skinUrl: null,
      expired: false,
      addedAt: new Date().toISOString(),
    });
  }
  return ipc<Account>('add_offline_account', { username });
}

export function removeAccount(id: string): Promise<void> {
  if (shouldMock()) return mocked(undefined);
  return ipcUnit('remove_account', { id });
}

export function refreshAccount(id: string): Promise<Account> {
  if (shouldMock()) {
    const found = MOCK_ACCOUNTS.find((item) => item.id === id);
    if (found === undefined) return Promise.reject(new Error('no account'));
    return mocked(found, 500);
  }
  return ipc<Account>('refresh_account', { id });
}
