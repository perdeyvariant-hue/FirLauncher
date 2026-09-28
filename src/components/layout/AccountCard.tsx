import type { ReactElement } from 'react';
import { AlertTriangle, UserPlus } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Tooltip } from '@/components/ui/Tooltip';
import { activeAccountOf, useAccounts } from '@/store/useAccounts';
import { useUI } from '@/store/useUI';
import { t } from '@/lib/i18n';

/** Bottom of the rail: whoever the next launch will use. */
export function AccountCard(): ReactElement {
  const account = useAccounts(activeAccountOf);
  const navigate = useUI((state) => state.navigate);

  const openAccounts = (): void => {
    navigate({ name: 'accounts' });
  };

  if (account === null) {
    return (
      <Tooltip content={t`Добавить аккаунт`} side="right">
        <button
          type="button"
          onClick={openAccounts}
          className="flex w-[84px] flex-col items-center gap-1.5 text-text-dim transition-[color,transform] duration-fast hover:text-accent active:scale-[0.94]"
        >
          <span className="grid h-10 w-10 place-items-center rounded-[11px] border border-dashed border-current">
            <UserPlus size={18} strokeWidth={1.6} />
          </span>
          <span className="text-[11px] font-semibold leading-none">{t`Войти`}</span>
        </button>
      </Tooltip>
    );
  }

  return (
    <Tooltip
      content={
        account.expired
          ? t`${account.username} — сессия истекла`
          : t`${account.username} · ${account.kind === 'offline' ? t`оффлайн` : 'Microsoft'}`
      }
      side="right"
    >
      <button
        type="button"
        onClick={openAccounts}
        className="flex w-[84px] flex-col items-center gap-1.5 text-text-dim transition-transform duration-fast active:scale-[0.94]"
      >
        <span className="relative rounded-[11px] shadow-[0_0_0_2px_rgb(var(--bg-rgb)),0_0_0_3.5px_rgb(var(--accent-rgb))]">
          <Avatar name={account.username} src={account.avatarUrl} size={40} />
          {account.expired && (
            <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-surface text-danger">
              <AlertTriangle size={10} strokeWidth={2} />
            </span>
          )}
        </span>
        <span className="max-w-[80px] truncate text-[11px] font-semibold">{account.username}</span>
      </button>
    </Tooltip>
  );
}
