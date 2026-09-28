import { useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Page } from '@/components/layout/PageHeader';
import { formatRelativeDate } from '@/lib/format';
import { useAccounts } from '@/store/useAccounts';
import { AddAccountDialog } from './AddAccountDialog';
import { LoginDialog } from './LoginDialog';
import { plural, t } from '@/lib/i18n';

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
    <Page
      title={t`Аккаунты`}
      subtitle={
        accounts.length === 0
          ? undefined
          : plural(accounts.length, ['аккаунт', 'аккаунта', 'аккаунтов'], ['account', 'accounts'])
      }
      actions={
        <Button
          iridescent
          icon={<Plus size={15} strokeWidth={2.2} />}
          onClick={() => {
            setAddOpen(true);
          }}
        >
          {t`Добавить`}
        </Button>
      }
    >
      {loading ? (
        <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3.5">
          {Array.from({ length: 2 }, (_, index) => (
            <Skeleton key={index} className="h-[140px]" />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title={t`Аккаунтов нет`}
          description={t`Войдите через Microsoft, чтобы играть на серверах, или создайте оффлайн-аккаунт для одиночной игры.`}
          action={
            <Button
              variant="primary"
              onClick={() => {
                setAddOpen(true);
              }}
            >
              {t`Добавить аккаунт`}
            </Button>
          }
        />
      ) : (
        <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3.5">
          {accounts.map((account, index) => {
            const active = account.id === activeId;
            const microsoft = account.kind === 'microsoft';
            return (
              <div
                key={account.id}
                className="glass stagger flex flex-col gap-4 rounded-xl p-[18px]"
                style={{ '--i': index } as CSSProperties}
              >
                <div className="flex items-center gap-3.5">
                  <Avatar name={account.username} src={account.avatarUrl} size={56} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-base font-semibold text-text">
                      <span className="truncate">{account.username}</span>
                      {active && <Badge tone="accent">{t`Активный`}</Badge>}
                      {account.expired && <Badge tone="danger">{t`Сессия истекла`}</Badge>}
                    </div>
                    <p className="mt-1 truncate text-[12.5px] text-text-dim">
                      {microsoft ? 'Microsoft' : t`Оффлайн`}
                      {t` · добавлен`} {formatRelativeDate(account.addedAt)}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  {!active && (
                    <Button
                      variant="primary"
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        setActive(account.id);
                      }}
                    >
                      {t`Сделать активным`}
                    </Button>
                  )}
                  {microsoft && account.expired && (
                    <Button
                      variant="primary"
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        setMsaOpen(true);
                      }}
                    >
                      {t`Войти заново`}
                    </Button>
                  )}
                  {microsoft && !account.expired && (
                    <Button
                      size="sm"
                      className="flex-1"
                      title={t`Обновить вход и скин`}
                      loading={refreshing === account.id}
                      onClick={() => {
                        setRefreshing(account.id);
                        void refresh(account.id).finally(() => {
                          setRefreshing(null);
                        });
                      }}
                    >
                      {t`Обновить`}
                    </Button>
                  )}
                  {!microsoft && active && (
                    <p className="flex h-8 flex-1 items-center text-xs text-text-faint">
                      {t`Одиночная игра и серверы без проверки лицензии`}
                    </p>
                  )}
                  <button
                    type="button"
                    aria-label={t`Удалить аккаунт`}
                    title={t`Удалить аккаунт`}
                    onClick={() => {
                      setPendingRemove(account.id);
                    }}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-danger shadow-rim transition-colors duration-fast hover:bg-danger/[0.12]"
                  >
                    <Trash2 size={14} strokeWidth={2} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

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

      <LoginDialog
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
    </Page>
  );
}
