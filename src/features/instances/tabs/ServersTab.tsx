import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Play, Plus, RefreshCw, Server, Signal, Trash2, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBlock } from '@/components/ui/ErrorBlock';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import * as instancesApi from '@/api/instances';
import type { ServerStatus } from '@/api/instances';
import { formatCompactNumber } from '@/lib/format';
import { useAsyncData } from '@/lib/useAsyncData';
import type { Instance } from '@/types/instance';
import { activeAccountOf, useAccounts } from '@/store/useAccounts';
import { useInstances } from '@/store/useInstances';
import { useToasts } from '@/store/useToasts';
import { t } from '@/lib/i18n';

type Ping = { readonly state: 'loading' } | { readonly state: 'ok'; readonly status: ServerStatus } | { readonly state: 'down' };

function Icon({ src }: { src: string | null }): ReactElement {
  if (src === null) {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-dim">
        <Server size={16} strokeWidth={1.5} />
      </span>
    );
  }
  return <img src={src} alt="" className="pixelated h-10 w-10 shrink-0 rounded-md bg-surface-2" />;
}

export function ServersTab({ instance }: { instance: Instance }): ReactElement {
  const { data, loading, error, reload } = useAsyncData(
    () => instancesApi.listServers(instance.id),
    [instance.id],
  );
  const launch = useInstances((state) => state.launch);
  const account = useAccounts(activeAccountOf);
  const notify = useToasts((state) => state.notify);
  const fail = useToasts((state) => state.fail);

  const [pings, setPings] = useState<Record<string, Ping>>({});
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);

  const servers = data ?? [];
  const running = instance.status.state === 'running';

  const pingAll = useCallback((addresses: readonly string[]) => {
    for (const target of addresses) {
      setPings((current) => ({ ...current, [target]: { state: 'loading' } }));
      instancesApi
        .pingServer(target)
        .then((status) => {
          setPings((current) => ({ ...current, [target]: { state: 'ok', status } }));
        })
        .catch(() => {
          setPings((current) => ({ ...current, [target]: { state: 'down' } }));
        });
    }
  }, []);

  useEffect(() => {
    if (data !== null) pingAll(data.map((server) => server.address));
  }, [data, pingAll]);

  const play = (target: string): void => {
    if (account === null) {
      notify(t`Сначала добавьте аккаунт`, 'error');
      return;
    }
    void launch(instance.id, account.id, target);
    notify(t`Запуск с входом на ${target}`, 'info');
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      await instancesApi.addServer(instance.id, name, address);
      setAdding(false);
      setName('');
      setAddress('');
      reload();
    } catch (raw) {
      fail(raw);
    }
    setSaving(false);
  };

  if (error !== null) return <ErrorBlock error={error} onRetry={reload} />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <p className="text-2xs text-text-dim">
          {t`Тот же список, что в меню «Сетевая игра». «Играть» запускает игру и сразу заходит на сервер.`}</p>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            icon={<RefreshCw size={13} strokeWidth={1.5} />}
            onClick={() => {
              pingAll(servers.map((server) => server.address));
            }}
          >
            {t`Обновить`}</Button>
          <Button
            size="sm"
            variant="primary"
            disabled={running}
            icon={<Plus size={14} strokeWidth={1.5} />}
            onClick={() => {
              setAdding(true);
            }}
          >
            {t`Добавить сервер`}</Button>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 2 }, (_, index) => (
            <Skeleton key={index} className="h-16" />
          ))}
        </div>
      ) : servers.length === 0 ? (
        <EmptyState
          compact
          icon={<Server size={20} strokeWidth={1.5} />}
          title={t`Серверов нет`}
          description={t`Добавьте сервер здесь или в игре — он появится в обоих местах.`}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {servers.map((server, index) => {
            const ping = pings[server.address];
            const status = ping?.state === 'ok' ? ping.status : null;
            return (
              <li key={`${server.address}-${String(index)}`} className="panel flex items-center gap-3 p-3">
                <Icon src={status?.favicon ?? server.icon} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <p className="truncate text-sm text-text">{server.name}</p>
                    <span className="truncate font-mono text-2xs text-text-dim">{server.address}</span>
                  </div>
                  <p className="mt-0.5 truncate text-2xs text-text-dim">
                    {ping === undefined || ping.state === 'loading'
                      ? t`Опрос…`
                      : ping.state === 'down'
                        ? t`Не отвечает`
                        : status !== null && (status.motd === '' ? status.version : status.motd)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {status !== null ? (
                    <>
                      <p className="inline-flex items-center gap-1 text-xs text-text">
                        <Signal size={12} strokeWidth={1.5} className="text-accent" />
                        {formatCompactNumber(status.online)} / {formatCompactNumber(status.max)}
                      </p>
                      <p className="text-2xs text-text-dim">
                        {status.latencyMs} {t` мс · `}{status.version}
                      </p>
                    </>
                  ) : ping?.state === 'down' ? (
                    <WifiOff size={14} strokeWidth={1.5} className="text-text-dim" />
                  ) : null}
                </div>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={running}
                  icon={<Play size={13} strokeWidth={1.5} />}
                  onClick={() => {
                    play(server.address);
                  }}
                >
                  {t`Играть`}</Button>
                <IconButton
                  label={t`Удалить сервер`}
                  tone="danger"
                  size="sm"
                  disabled={running}
                  icon={<Trash2 size={14} strokeWidth={1.5} />}
                  onClick={() => {
                    void instancesApi
                      .removeServer(instance.id, index)
                      .then(reload)
                      .catch((raw: unknown) => fail(raw));
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={adding}
        onClose={() => {
          setAdding(false);
        }}
        title={t`Добавить сервер`}
        width="sm"
        busy={saving}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setAdding(false);
              }}
            >
              {t`Отмена`}</Button>
            <Button
              variant="primary"
              loading={saving}
              disabled={address.trim() === ''}
              onClick={() => {
                void save();
              }}
            >
              {t`Добавить`}</Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 py-2">
          <Input
            label={t`Адрес`}
            placeholder={t`play.example.net или 1.2.3.4:25565`}
            value={address}
            monospace
            onChange={(event) => {
              setAddress(event.target.value);
            }}
          />
          <Input
            label={t`Название`}
            placeholder={t`Как сервер будет подписан в списке`}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        </div>
      </Dialog>
    </div>
  );
}
