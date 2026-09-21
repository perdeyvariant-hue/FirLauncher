import type { ReactElement } from 'react';
import { AlertTriangle, UserPlus } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Tooltip } from '@/components/ui/Tooltip';
import { activeAccountOf, useAccounts } from '@/store/useAccounts';
import { useUI } from '@/store/useUI';

/** Bottom of the sidebar: whoever the next launch will use. */
export function AccountCard(): ReactElement {
  const account = useAccounts(activeAccountOf);
  const navigate = useUI((state) => state.navigate);

  const openAccounts = (): void => {
    navigate({ name: 'accounts' });
  };

  if (account === null) {
    return (
      <div className="p-2">
        <Tooltip content="Добавить аккаунт" side="right" className="w-full">
          <button
            type="button"
            onClick={openAccounts}
            className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-border py-2.5 text-text-dim transition-colors duration-fast ease-out hover:border-accent hover:text-accent"
          >
            <UserPlus size={18} strokeWidth={1.5} />
            <span className="text-2xs leading-none">Войти</span>
          </button>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="p-2">
      <Tooltip
        content={
          account.expired
            ? `${account.username} — сессия истекла`
            : `${account.username} · ${account.kind === 'offline' ? 'оффлайн' : 'Microsoft'}`
        }
        side="right"
        className="w-full"
      >
        <button
          type="button"
          onClick={openAccounts}
          className="flex w-full flex-col items-center gap-1.5 rounded-lg py-2 transition-colors duration-fast ease-out hover:bg-surface-2"
        >
          <span className="relative">
            <Avatar
              name={account.username}
              src={account.avatarUrl}
              size={34}
            />
            {account.expired && (
              <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-surface text-danger">
                <AlertTriangle size={10} strokeWidth={2} />
              </span>
            )}
          </span>
          <span className="w-full truncate px-1 text-center text-2xs leading-none text-text-dim">
            {account.username}
          </span>
        </button>
      </Tooltip>
    </div>
  );
}
