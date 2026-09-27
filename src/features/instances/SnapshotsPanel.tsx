import { useState } from 'react';
import type { ReactElement } from 'react';
import { Camera, History, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import * as instancesApi from '@/api/instances';
import type { InstanceSnapshot } from '@/api/instances';
import { formatRelativeDate } from '@/lib/format';
import { useAsyncData } from '@/lib/useAsyncData';
import type { Instance } from '@/types/instance';
import { LOADER_LABELS } from '@/types/instance';
import { useInstances } from '@/store/useInstances';
import { useToasts } from '@/store/useToasts';
import { t, translate } from '@/lib/i18n';

function setupOf(snapshot: InstanceSnapshot): string {
  const loader =
    snapshot.loader === 'vanilla'
      ? t`без лоадера`
      : `${LOADER_LABELS[snapshot.loader]} ${snapshot.loaderVersion ?? ''}`.trim();
  return `${snapshot.mcVersion} · ${loader} · ${t`модов: ${String(snapshot.mods)}`}`;
}

/**
 * Snapshots of the instance's mods, configs and loader, taken automatically
 * before updates and loader changes, and on demand. Worlds are not included.
 */
export function SnapshotsPanel({ instance }: { instance: Instance }): ReactElement {
  const snapshots = useAsyncData<InstanceSnapshot[]>(
    () => instancesApi.listSnapshots(instance.id),
    [instance.id, instance.loader, instance.loaderVersion],
  );
  const adopt = useInstances((state) => state.adopt);
  const notify = useToasts((state) => state.notify);
  const fail = useToasts((state) => state.fail);

  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<{ kind: 'restore' | 'delete'; snapshot: InstanceSnapshot } | null>(null);
  const [working, setWorking] = useState(false);
  const running = instance.status.state === 'running';

  const save = (): void => {
    setSaving(true);
    const reason = name.trim() === '' ? t`Снимок вручную` : name.trim();
    instancesApi
      .takeSnapshot(instance.id, reason)
      .then(() => {
        setNaming(false);
        setName('');
        snapshots.reload();
      })
      .catch((raw: unknown) => fail(raw))
      .finally(() => {
        setSaving(false);
      });
  };

  const confirm = (): void => {
    if (pending === null) return;
    const { kind, snapshot } = pending;
    setWorking(true);
    const action =
      kind === 'restore'
        ? instancesApi.restoreSnapshot(instance.id, snapshot.id).then((updated) => {
            adopt(updated);
            notify(t`Сборка возвращена к снимку от ${formatRelativeDate(snapshot.createdAt)}`, 'success');
          })
        : instancesApi.deleteSnapshot(instance.id, snapshot.id);
    action
      .then(() => {
        snapshots.reload();
      })
      .catch((raw: unknown) => fail(raw))
      .finally(() => {
        setWorking(false);
        setPending(null);
      });
  };

  const list = snapshots.data ?? [];

  return (
    <div className="panel flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-xs font-semibold text-text">{t`История сборки`}</h3>
          <p className="mt-1 text-xs leading-relaxed text-text-dim">
            {t`Снимки модов, конфигов и лоадера. Делаются сами перед обновлениями и сменой лоадера — если что-то сломалось, откатитесь. Миры в снимки не входят.`}
          </p>
        </div>
        {!naming && (
          <Button
            size="sm"
            icon={<Camera size={13} strokeWidth={1.5} />}
            onClick={() => {
              setNaming(true);
            }}
          >
            {t`Сделать снимок`}</Button>
        )}
      </div>

      {naming && (
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <div className="min-w-0 flex-1">
            <Input
              autoFocus
              value={name}
              maxLength={80}
              placeholder={t`Например: всё работает`}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </div>
          <Button size="sm" variant="primary" type="submit" loading={saving}>
            {t`Сохранить`}</Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={() => {
              setNaming(false);
            }}
          >
            {t`Отмена`}</Button>
        </form>
      )}

      {list.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {list.map((snapshot) => (
            <li
              key={snapshot.id}
              className="flex items-center gap-3 rounded-lg bg-[rgb(var(--text-rgb)/0.04)] px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-xs text-text">{translate(snapshot.reason)}</p>
                  {snapshot.automatic && <Badge tone="outline">{t`авто`}</Badge>}
                </div>
                <p className="truncate text-2xs text-text-dim">
                  {formatRelativeDate(snapshot.createdAt)} · {setupOf(snapshot)}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={running}
                icon={<History size={13} strokeWidth={1.5} />}
                onClick={() => {
                  setPending({ kind: 'restore', snapshot });
                }}
              >
                {t`Откатить`}</Button>
              <IconButton
                label={t`Удалить снимок`}
                tone="danger"
                size="sm"
                icon={<Trash2 size={13} strokeWidth={1.5} />}
                onClick={() => {
                  setPending({ kind: 'delete', snapshot });
                }}
              />
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pending !== null}
        destructive={pending?.kind === 'delete'}
        busy={working}
        title={pending?.kind === 'restore' ? t`Откатить сборку?` : t`Удалить снимок?`}
        description={
          pending === null
            ? ''
            : pending.kind === 'restore'
              ? t`Моды, конфиги, ресурспаки и лоадер вернутся к состоянию «${translate(pending.snapshot.reason)}» (${setupOf(pending.snapshot)}). Текущее состояние сначала сохранится снимком, так что откат можно отменить. Миры не затрагиваются.`
              : t`Снимок будет удалён. Сама сборка не изменится.`
        }
        confirmLabel={pending?.kind === 'restore' ? t`Откатить` : t`Удалить`}
        onCancel={() => {
          setPending(null);
        }}
        onConfirm={confirm}
      />
    </div>
  );
}
