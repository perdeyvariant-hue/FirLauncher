import { useState } from 'react';
import type { ReactElement } from 'react';
import { Archive, ArchiveRestore, FileDown, Globe2, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBlock } from '@/components/ui/ErrorBlock';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton } from '@/components/ui/Skeleton';
import * as instancesApi from '@/api/instances';
import { formatBytes, formatRelativeDate } from '@/lib/format';
import { isTauri } from '@/lib/ipc';
import { useAsyncData } from '@/lib/useAsyncData';
import type { Instance, WorldBackup, WorldEntry } from '@/types/instance';
import { useToasts } from '@/store/useToasts';
import { useUI } from '@/store/useUI';
import { locale, t } from '@/lib/i18n';

type Pending =
  | { readonly kind: 'restore'; readonly backup: WorldBackup }
  | { readonly kind: 'delete-world'; readonly world: WorldEntry }
  | { readonly kind: 'delete-backup'; readonly backup: WorldBackup };

function backupDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
}

export function WorldsTab({ instance }: { instance: Instance }): ReactElement {
  const revision = useUI((state) => state.contentRevision);
  const worlds = useAsyncData<WorldEntry[]>(
    () => instancesApi.listWorlds(instance.id),
    [instance.id, revision],
  );
  const backups = useAsyncData<WorldBackup[]>(
    () => instancesApi.listWorldBackups(instance.id),
    [instance.id],
  );
  const notify = useToasts((state) => state.notify);
  const fail = useToasts((state) => state.fail);
  const [working, setWorking] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const running = instance.status.state === 'running';

  const run = async (key: string, work: () => Promise<string | null>): Promise<void> => {
    setWorking(key);
    try {
      const message = await work();
      if (message !== null) notify(message, 'success');
      worlds.reload();
      backups.reload();
    } catch (raw) {
      fail(raw);
    }
    setWorking(null);
  };

  const importArchive = (): void => {
    if (!isTauri()) {
      notify(t`Импорт доступен только в приложении`);
      return;
    }
    void run('import', async () => {
      const path = await instancesApi.pickWorldArchive();
      if (path === null) return null;
      const name = await instancesApi.importWorld(instance.id, path);
      return t`Мир «${name}» добавлен`;
    });
  };

  const confirm = (): void => {
    if (pending === null) return;
    const action = pending;
    setPending(null);
    switch (action.kind) {
      case 'restore':
        void run(action.backup.fileName, async () => {
          const world = await instancesApi.restoreWorldBackup(instance.id, action.backup.fileName);
          return t`Мир «${world}» восстановлен. Прежнее состояние сохранено в копиях.`;
        });
        break;
      case 'delete-world':
        void run(action.world.folderName, async () => {
          await instancesApi.deleteWorld(instance.id, action.world.folderName);
          return t`Мир «${action.world.name}» удалён`;
        });
        break;
      case 'delete-backup':
        void run(action.backup.fileName, async () => {
          await instancesApi.deleteWorldBackup(instance.id, action.backup.fileName);
          return null;
        });
        break;
    }
  };

  if (worlds.error !== null) return <ErrorBlock error={worlds.error} onRetry={worlds.reload} />;

  const list = worlds.data ?? [];
  const copies = backups.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <p className="text-2xs text-text-dim">
          {running
            ? t`Игра запущена — копии и восстановление доступны после выхода.`
            : t`Резервные копии хранятся в папке backups этой сборки.`}
        </p>
        <div className="ml-auto">
          <Button
            size="sm"
            loading={working === 'import'}
            icon={<FileDown size={14} strokeWidth={1.5} />}
            onClick={importArchive}
          >
            {t`Импортировать мир (.zip)`}</Button>
        </div>
      </div>

      {worlds.loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-14" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          compact
          icon={<Globe2 size={20} strokeWidth={1.5} />}
          title={t`Миров пока нет`}
          description={t`Созданные в игре миры появятся здесь. Готовый мир можно импортировать из .zip.`}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((world) => (
            <li key={world.folderName} className="panel flex items-center gap-3 p-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-dim">
                <Globe2 size={16} strokeWidth={1.5} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-text">{world.name}</p>
                <p className="mt-0.5 truncate text-2xs text-text-dim">
                  {world.gameMode ?? '—'} · {formatBytes(world.sizeBytes)} ·{' '}
                  {formatRelativeDate(world.lastPlayedAt)}
                </p>
              </div>
              <Button
                size="sm"
                disabled={running}
                loading={working === `backup:${world.folderName}`}
                icon={<Archive size={13} strokeWidth={1.5} />}
                onClick={() => {
                  void run(`backup:${world.folderName}`, async () => {
                    const made = await instancesApi.backupWorld(instance.id, world.folderName);
                    return t`Копия «${world.name}» сохранена (${formatBytes(made.sizeBytes)})`;
                  });
                }}
              >
                {t`Резервная копия`}</Button>
              <IconButton
                label={t`Удалить мир`}
                tone="danger"
                size="sm"
                disabled={running}
                icon={<Trash2 size={14} strokeWidth={1.5} />}
                onClick={() => {
                  setPending({ kind: 'delete-world', world });
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {copies.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-text">{t`Резервные копии`}</h3>
          <ul className="flex flex-col gap-1.5">
            {copies.map((backup) => (
              <li key={backup.fileName} className="panel flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-xs text-text">{backup.world}</p>
                    {backup.automatic && <Badge tone="outline">{t`авто`}</Badge>}
                  </div>
                  <p className="text-2xs text-text-dim">
                    {backupDate(backup.createdAt)} · {formatBytes(backup.sizeBytes)}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={running}
                  loading={working === backup.fileName}
                  icon={<ArchiveRestore size={13} strokeWidth={1.5} />}
                  onClick={() => {
                    setPending({ kind: 'restore', backup });
                  }}
                >
                  {t`Восстановить`}</Button>
                <IconButton
                  label={t`Удалить копию`}
                  tone="danger"
                  size="sm"
                  icon={<Trash2 size={13} strokeWidth={1.5} />}
                  onClick={() => {
                    setPending({ kind: 'delete-backup', backup });
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={pending !== null}
        destructive={pending?.kind !== 'restore'}
        title={
          pending === null
            ? ''
            : pending.kind === 'restore'
              ? t`Восстановить «${pending.backup.world}»?`
              : pending.kind === 'delete-world'
                ? t`Удалить мир «${pending.world.name}»?`
                : t`Удалить резервную копию?`
        }
        description={
          pending?.kind === 'restore'
            ? t`Мир вернётся к состоянию на ${backupDate(pending.backup.createdAt)}. Текущее состояние сначала сохранится как автоматическая копия.`
            : pending?.kind === 'delete-world'
              ? t`Папка мира будет удалена безвозвратно. Сделайте резервную копию, если сомневаетесь.`
              : t`Файл копии будет удалён.`
        }
        confirmLabel={pending?.kind === 'restore' ? t`Восстановить` : t`Удалить`}
        onCancel={() => {
          setPending(null);
        }}
        onConfirm={confirm}
      />
    </div>
  );
}
