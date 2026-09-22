import { useState } from 'react';
import type { ReactElement } from 'react';
import { Check, RotateCw, Trash2, UserPlus, Users } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatRelativeDate } from '@/lib/format';
import { useAccounts } from '@/store/useAccounts';
import { AddAccountDialog } from './AddAccountDialog';
import { DeviceCodeDialog } from './DeviceCodeDialog';
import { t } from '@/lib/i18n';

export function AccountsPage(): ReactElement {
  const accounts = useAccounts((state) => state.accounts);
  const activeId = useAccounts((state) => state.activeId);
  const loading = useAccounts((state) => state.loading);
  const setActive = useAccounts((state) => state.setActive);
  const remove = useAccounts((state) => state.remove);
  const refresh = useAccounts((state) => state.refresh);

  const [addOpen, setAddOpen] = useState(false);
  const [msaOpen, setMsaOpen] = useState(false);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  const removeTarget = accounts.find((account) => account.id === pendingRemove) ?? null;

  return (
    <div className="flex h-full flex-col">
      <header className="hairline-b flex h-14 shrink-0 items-center px-6">
        <h1 className="text-sm font-semibold text-text">{t`Аккаунты`}</h1>
        <div className="ml-auto">
          <Button
            variant="primary"
            size="sm"
            icon={<UserPlus size={14} strokeWidth={1.5} />}
            onClick={() => {
              setAddOpen(true);
            }}
          >
            {t`Добавить`}</Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 2 }, (_, index) => (
              <Skeleton key={index} className="h-[68px]" />
            ))}
          </div>
        ) : accounts.length === 0 ? (
          <EmptyState
            icon={<Users size={20} strokeWidth={1.5} />}
            title={t`Аккаунтов нет`}
            description={t`Войдите через Microsoft, чтобы играть на серверах, или создайте оффлайн-аккаунт для одиночной игры.`}
            action={
              <Button
                variant="primary"
                icon={<UserPlus size={15} strokeWidth={1.5} />}
                onClick={() => {
                  setAddOpen(true);
                }}
              >
                {t`Добавить аккаунт`}</Button>
            }
          />
        ) : (
          <ul className="flex max-w-[720px] flex-col gap-2">
            {accounts.map((account) => {
              const active = account.id === activeId;
              return (
                <li
                  key={account.id}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border bg-surface p-3',
                    'transition-[border-color] duration-fast ease-out',
                    active ? 'border-accent/45' : 'border-border hover:border-text-dim/35',
                  )}
                >
                  <Avatar
                    name={account.username}
                    src={account.avatarUrl}
                    size={40}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm text-text">{account.username}</p>
                      {active && <Badge tone="accent">{t`Активный`}</Badge>}
                      {account.expired && <Badge tone="danger">{t`Сессия истекла`}</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-2xs text-text-dim">
                      {account.kind === 'microsoft' ? 'Microsoft' : t`Оффлайн`} {t` · добавлен`}{' '}
                      {formatRelativeDate(account.addedAt)}
                    </p>
                  </div>

                  {!active && (
                    <Button
                      size="sm"
                      icon={<Check size={13} strokeWidth={1.5} />}
                      onClick={() => {
                        setActive(account.id);
                      }}
                    >
                      {t`Сделать активным`}</Button>
                  )}

                  {account.kind === 'microsoft' && account.expired && (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        setMsaOpen(true);
                      }}
                    >
                      {t`Войти заново`}</Button>
                  )}

                  {account.kind === 'microsoft' && !account.expired && (
                    <IconButton
                      label={t`Обновить вход и скин`}
                      size="sm"
                      disabled={refreshing === account.id}
                      icon={
                        <RotateCw
                          size={14}
                          strokeWidth={1.5}
                          className={cn(refreshing === account.id && 'animate-spin-slow')}
                        />
                      }
                      onClick={() => {
                        setRefreshing(account.id);
                        void refresh(account.id).finally(() => {
                          setRefreshing(null);
                        });
                      }}
                    />
                  )}

                  <IconButton
                    label={t`Удалить аккаунт`}
                    tone="danger"
                    size="sm"
                    icon={<Trash2 size={14} strokeWidth={1.5} />}
                    onClick={() => {
                      setPendingRemove(account.id);
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <AddAccountDialog
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
        }}
        onMicrosoft={() => {
          setAddOpen(false);
          setMsaOpen(true);
        }}
      />

      <DeviceCodeDialog
        open={msaOpen}
        onClose={() => {
          setMsaOpen(false);
        }}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        destructive
        title={t`Удалить аккаунт «${removeTarget?.username ?? ''}»?`}
        description={t`Сохранённый токен будет удалён из системного хранилища. Сами миры и сборки не пострадают.`}
        confirmLabel={t`Удалить`}
        onCancel={() => {
          setPendingRemove(null);
        }}
        onConfirm={() => {
          if (pendingRemove !== null) void remove(pendingRemove);
          setPendingRemove(null);
        }}
      />
    </div>
  );
}
