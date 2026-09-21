import { create } from 'zustand';
import type { Account } from '@/types/account';
import * as accountsApi from '@/api/accounts';
import { onEvent } from '@/lib/events';
import { useToasts } from './useToasts';

const ACTIVE_KEY = 'firlauncher.activeAccountId';

interface AccountsState {
  accounts: Account[];
  activeId: string | null;
  loading: boolean;
  load: () => Promise<void>;
  setActive: (id: string) => void;
  addOffline: (username: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Renews tokens and pulls the current name and skin. */
  refresh: (id: string) => Promise<void>;
  /** Re-reads the list when the backend changes accounts on its own. */
  subscribe: () => Promise<() => void>;
}

function readStoredActiveId(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

function storeActiveId(id: string | null): void {
  try {
    if (id === null) window.localStorage.removeItem(ACTIVE_KEY);
    else window.localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // Private mode / blocked storage: the choice simply does not persist.
  }
}

export const useAccounts = create<AccountsState>()((set, get) => ({
  accounts: [],
  activeId: null,
  loading: false,

  load: async () => {
    set({ loading: true });
    try {
      const accounts = await accountsApi.listAccounts();
      const stored = readStoredActiveId();
      const activeId =
        stored !== null && accounts.some((account) => account.id === stored)
          ? stored
          : (accounts[0]?.id ?? null);
      set({ accounts, activeId, loading: false });
    } catch (raw) {
      useToasts.getState().fail(raw, () => void get().load());
      set({ loading: false });
    }
  },

  setActive: (id) => {
    storeActiveId(id);
    set({ activeId: id });
  },

  addOffline: async (username) => {
    try {
      const account = await accountsApi.addOfflineAccount(username);
      set((state) => ({ accounts: [...state.accounts, account] }));
      get().setActive(account.id);
      useToasts.getState().notify(`Аккаунт ${account.username} добавлен`, 'success');
    } catch (raw) {
      useToasts.getState().fail(raw);
    }
  },

  refresh: async (id) => {
    try {
      const account = await accountsApi.refreshAccount(id);
      set((state) => ({
        accounts: state.accounts.map((item) => (item.id === account.id ? account : item)),
      }));
      useToasts.getState().notify(`${account.username}: вход обновлён`, 'success');
    } catch (raw) {
      useToasts.getState().fail(raw, () => void get().refresh(id));
      // A failed refresh may have marked the account expired server-side.
      await get().load();
    }
  },

  subscribe: async () =>
    onEvent('accounts://changed', () => {
      void get().load();
    }),

  remove: async (id) => {
    try {
      await accountsApi.removeAccount(id);
      const accounts = get().accounts.filter((account) => account.id !== id);
      const activeId = get().activeId === id ? (accounts[0]?.id ?? null) : get().activeId;
      storeActiveId(activeId);
      set({ accounts, activeId });
    } catch (raw) {
      useToasts.getState().fail(raw);
    }
  },
}));

export function activeAccountOf(state: AccountsState): Account | null {
  return state.accounts.find((account) => account.id === state.activeId) ?? null;
}
