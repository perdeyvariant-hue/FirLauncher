import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { ArrowUpCircle, Gauge, History, ListChecks, Package, Plus, Search, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBlock } from '@/components/ui/ErrorBlock';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import * as instancesApi from '@/api/instances';
import { ContentBrowser } from '@/features/mods/ContentBrowser';
import { OptimizeDialog } from '@/features/mods/OptimizeDialog';
import { ProjectDialog } from '@/features/mods/ProjectDialog';
import type { ProjectTarget } from '@/features/mods/ProjectDialog';
import { useContentInstaller } from '@/features/mods/useContentInstaller';
import { UpdatesBar } from '@/features/mods/UpdatesBar';
import { useContentUpdates } from '@/features/mods/useContentUpdates';
import { formatBytes } from '@/lib/format';
import { useAsyncData } from '@/lib/useAsyncData';
import { ModIcon } from '@/features/mods/ModIcon';
import type { InstalledMod, Instance } from '@/types/instance';
import { isProviderId, providerLabel } from '@/types/mod';
import { useToasts } from '@/store/useToasts';
import { useUI } from '@/store/useUI';
import { t } from '@/lib/i18n';

export function ModsTab({ instance }: { instance: Instance }): ReactElement {
  const revision = useUI((state) => state.contentRevision);
  const { data, loading, error, reload } = useAsyncData<InstalledMod[]>(
    () => instancesApi.listInstalledMods(instance.id),
    [instance.id, revision],
  );
  const fail = useToasts((state) => state.fail);

  const [browsing, setBrowsing] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [search, setSearch] = useState('');
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  // The installed file whose description is open.
  const [described, setDescribed] = useState<
    (ProjectTarget & { readonly name: string; readonly versionId: string | null }) | null
  >(null);

  const updates = useContentUpdates(instance.id, 'mod', reload);
  const installer = useContentInstaller(instance, 'mod', (plan) => {
    // A new version replaces the file an update was found for.
    for (const mod of data ?? []) {
      if (mod.source?.projectId === plan.primary.projectId) updates.forget(mod.fileName);
    }
    reload();
  });

  const mods = useMemo(() => data ?? [], [data]);
  // A fresh listing is the truth; optimistic toggles are no longer needed.
  useEffect(() => {
    setOverrides({});
  }, [data]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (needle === '') return mods;
    return mods.filter(
      (mod) =>
        mod.name.toLowerCase().includes(needle) || mod.fileName.toLowerCase().includes(needle),
    );
  }, [mods, search]);

  const vanilla = instance.loader === 'vanilla';
  const isEnabled = (mod: InstalledMod): boolean => overrides[mod.fileName] ?? mod.enabled;
  const anyPending = updates.updates.size > 0;

  const notify = useToasts((state) => state.notify);

  // Picking several mods at once: a checkbox per row and a bar of actions.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pendingBulk, setPendingBulk] = useState<{
    mods: InstalledMod[];
    dependents: string[];
  } | null>(null);

  const stopPicking = (): void => {
    setPicking(false);
    setPicked(new Set());
  };

  const pickedMods = (): InstalledMod[] => (data ?? []).filter((mod) => picked.has(mod.fileName));

  /** Switches every picked mod on or off, one file at a time. */
  const bulkToggle = async (enabled: boolean): Promise<void> => {
    setBulkBusy(true);
    let failed = 0;
    for (const mod of pickedMods()) {
      if (mod.enabled === enabled) continue;
      try {
        await instancesApi.setModEnabled(instance.id, mod.fileName, enabled);
      } catch {
        failed += 1;
      }
    }
    setBulkBusy(false);
    // File names changed (.jar <-> .jar.disabled), so the picks are stale.
    stopPicking();
    reload();
    if (failed > 0) notify(t`Не удалось переключить модов: ${String(failed)}`, 'error');
  };

  /** Asks first, naming what else would break that is not going too. */
  const requestBulkRemove = async (): Promise<void> => {
    const mods = pickedMods();
    if (mods.length === 0) return;
    setBulkBusy(true);
    const going = new Set(mods.map((mod) => mod.name));
    const lists = await Promise.all(
      mods.map((mod) => instancesApi.modDependents(instance.id, mod.fileName).catch(() => [] as string[])),
    );
    setBulkBusy(false);
    const dependents = [...new Set(lists.flat())].filter((name) => !going.has(name)).sort();
    setPendingBulk({ mods, dependents });
  };

  const bulkRemove = async (mods: InstalledMod[]): Promise<void> => {
    setBulkBusy(true);
    let failed = 0;
    for (const mod of mods) {
      try {
        await instancesApi.removeMod(instance.id, mod.fileName);
        updates.forget(mod.fileName);
      } catch {
        failed += 1;
      }
    }
    setBulkBusy(false);
    stopPicking();
    reload();
    if (failed > 0) notify(t`Не удалось удалить модов: ${String(failed)}`, 'error');
  };
  /** A removal waiting on the question "others need this — delete anyway?". */
  const [pendingRemoval, setPendingRemoval] = useState<{
    mod: InstalledMod;
    dependents: string[];
  } | null>(null);

  const removeNow = (mod: InstalledMod): void => {
    void instancesApi
      .removeMod(instance.id, mod.fileName)
      .then(() => {
        updates.forget(mod.fileName);
        reload();
      })
      .catch((raw: unknown) => fail(raw));
  };

  // Deleting something others depend on asks first; everything else goes at once.
  const requestRemove = (mod: InstalledMod): void => {
    void instancesApi
      .modDependents(instance.id, mod.fileName)
      .catch(() => [] as string[])
      .then((dependents) => {
        if (dependents.length === 0) removeNow(mod);
        else setPendingRemoval({ mod, dependents });
      });
  };

  const toggle = (mod: InstalledMod, enabled: boolean): void => {
    setOverrides((current) => ({ ...current, [mod.fileName]: enabled }));
    instancesApi
      .setModEnabled(instance.id, mod.fileName, enabled)
      // The file was renamed (.jar <-> .jar.disabled); later actions need the
      // new name, including a pending update found for the old one.
      .then(() => {
        const renamed = enabled
          ? mod.fileName.replace(/\.disabled$/, '')
          : `${mod.fileName}.disabled`;
        updates.rename(mod.fileName, renamed);
        reload();
        if (!enabled) {
          void instancesApi
            .modDependents(instance.id, renamed)
            .then((dependents) => {
              if (dependents.length > 0) {
                notify(t`Без «${mod.name}» не запустятся: ${dependents.join(', ')}`, 'error');
              }
            })
            .catch(() => undefined);
        }
      })
      .catch((raw: unknown) => {
        setOverrides((current) => ({ ...current, [mod.fileName]: !enabled }));
        fail(raw);
      });
  };

  if (browsing) {
    return (
      <ContentBrowser
        instance={instance}
        kind="mod"
        onBack={() => {
          setBrowsing(false);
        }}
        onInstalled={reload}
      />
    );
  }

  if (error !== null) return <ErrorBlock error={error} onRetry={reload} />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-[240px]">
          <Input
            placeholder={t`Поиск по модам`}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            leading={<Search size={14} strokeWidth={1.5} />}
          />
        </div>

        <UpdatesBar state={updates} canCheck={!vanilla && mods.length > 0} />

        {picking ? (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-xs text-text-dim">{t`Выбрано: ${String(picked.size)}`}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={bulkBusy}
              onClick={() => {
                setPicked(
                  picked.size === filtered.length ? new Set() : new Set(filtered.map((mod) => mod.fileName)),
                );
              }}
            >
              {picked.size === filtered.length ? t`Снять все` : t`Выбрать все`}</Button>
            <Button
              size="sm"
              disabled={picked.size === 0 || bulkBusy}
              onClick={() => {
                void bulkToggle(true);
              }}
            >
              {t`Включить`}</Button>
            <Button
              size="sm"
              disabled={picked.size === 0 || bulkBusy}
              onClick={() => {
                void bulkToggle(false);
              }}
            >
              {t`Выключить`}</Button>
            <Button
              size="sm"
              variant="danger"
              loading={bulkBusy}
              disabled={picked.size === 0}
              icon={<Trash2 size={13} strokeWidth={1.5} />}
              onClick={() => {
                void requestBulkRemove();
              }}
            >
              {t`Удалить`}</Button>
            <Button size="sm" variant="primary" disabled={bulkBusy} onClick={stopPicking}>
              {t`Готово`}</Button>
          </div>
        ) : (
        <div className="ml-auto flex items-center gap-2">
          {mods.length > 1 && (
            <Button
              size="sm"
              variant="ghost"
              icon={<ListChecks size={14} strokeWidth={1.5} />}
              onClick={() => {
                setPicking(true);
              }}
            >
              {t`Выбрать`}</Button>
          )}
          {vanilla && (
            <span className="text-2xs text-text-dim">{t`Моды работают только со сборками с лоадером`}</span>
          )}
          <Button
            size="sm"
            disabled={vanilla}
            icon={<Gauge size={14} strokeWidth={1.5} />}
            onClick={() => {
              setOptimizing(true);
            }}
          >
            {t`Оптимизировать`}</Button>
          <Button
            variant="primary"
            size="sm"
            disabled={vanilla}
            icon={<Plus size={14} strokeWidth={1.5} />}
            onClick={() => {
              setBrowsing(true);
            }}
          >
            {t`Добавить моды`}</Button>
        </div>
        )}
      </div>

      <OptimizeDialog
        instance={instance}
        open={optimizing}
        onClose={() => {
          setOptimizing(false);
        }}
        onDone={reload}
      />

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-14" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          compact
          icon={<Package size={20} strokeWidth={1.5} />}
          title={mods.length === 0 ? t`Моды не установлены` : t`Ничего не найдено`}
          description={
            mods.length === 0
              ? vanilla
                ? t`В ванильную сборку моды не ставятся — создайте сборку с Fabric, Quilt, Forge или NeoForge.`
                : t`Найдите моды на Modrinth или CurseForge и поставьте их в эту сборку в один клик.`
              : undefined
          }
          action={
            mods.length === 0 && !vanilla ? (
              <Button
                variant="primary"
                size="sm"
                icon={<Plus size={14} strokeWidth={1.5} />}
                onClick={() => {
                  setBrowsing(true);
                }}
              >
                {t`Добавить моды`}</Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((mod) => {
            const update = updates.updates.get(mod.fileName);
            const newer = update?.latest.versionNumber ?? mod.updateAvailable;
            const source = mod.source;
            const provider = source !== null && isProviderId(source.provider) ? source.provider : null;
            return (
              <li
                key={mod.fileName}
                className="panel flex items-center gap-3 p-3 transition-[border-color] duration-fast ease-out hover:border-text-dim/35"
              >
                {picking && (
                  <Checkbox
                    label={t`Выбрать ${mod.name}`}
                    checked={picked.has(mod.fileName)}
                    onChange={(on) => {
                      setPicked((current) => {
                        const next = new Set(current);
                        if (on) next.add(mod.fileName);
                        else next.delete(mod.fileName);
                        return next;
                      });
                    }}
                  />
                )}
                {!picking &&
                  anyPending &&
                  (update === undefined ? (
                    <span className="w-4 shrink-0" />
                  ) : (
                    <Checkbox
                      label={t`Обновить ${mod.name}`}
                      checked={updates.selected.has(mod.fileName)}
                      disabled={updates.updating.has(mod.fileName)}
                      onChange={(on) => {
                        updates.setSelected(mod.fileName, on);
                      }}
                    />
                  ))}

                <Switch
                  checked={isEnabled(mod)}
                  onChange={(value) => {
                    toggle(mod, value);
                  }}
                />

                <ModIcon
                  instanceId={instance.id}
                  fileName={mod.fileName}
                  name={mod.name}
                  className={cn(!isEnabled(mod) && 'opacity-40 grayscale')}
                />

                <button
                  type="button"
                  disabled={source === null || provider === null}
                  title={provider === null ? undefined : t`Открыть описание`}
                  onClick={() => {
                    if (source === null || provider === null) return;
                    setDescribed({
                      provider,
                      projectId: source.projectId,
                      preview: null,
                      name: mod.name,
                      versionId: source.versionId,
                    });
                  }}
                  className="group min-w-0 flex-1 rounded-md text-left disabled:cursor-default"
                >
                  <div className="flex items-center gap-2">
                    <p
                      className={cn(
                        'truncate text-sm text-text transition-colors duration-fast ease-out',
                        provider !== null && 'group-hover:text-accent',
                      )}
                    >
                      {mod.name}
                    </p>
                    {mod.version !== null && <Badge tone="outline">{mod.version}</Badge>}
                    {newer !== null && <Badge tone="accent">→ {newer}</Badge>}
                    {source !== null && (
                      <Badge tone="neutral">{providerLabel(source.provider)}</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-2xs text-text-dim">
                    {mod.fileName} · {formatBytes(mod.sizeBytes)}
                  </p>
                </button>

                {update !== undefined && (
                  <IconButton
                    label={t`Обновить до ${update.latest.versionNumber}`}
                    size="sm"
                    disabled={updates.updating.has(mod.fileName)}
                    icon={<ArrowUpCircle size={14} strokeWidth={1.5} />}
                    onClick={() => {
                      void updates.apply([update]);
                    }}
                  />
                )}

                {source !== null && provider !== null && (
                  <IconButton
                    label={t`Сменить версию`}
                    size="sm"
                    icon={<History size={14} strokeWidth={1.5} />}
                    onClick={() => {
                      installer.chooseVersion({
                        provider,
                        projectId: source.projectId,
                        name: mod.name,
                        currentVersionId: source.versionId,
                      });
                    }}
                  />
                )}

                <IconButton
                  label={t`Удалить мод`}
                  tone="danger"
                  size="sm"
                  icon={<Trash2 size={14} strokeWidth={1.5} />}
                  onClick={() => {
                    requestRemove(mod);
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={pendingBulk !== null}
        destructive
        busy={bulkBusy}
        title={pendingBulk === null ? '' : t`Удалить модов: ${String(pendingBulk.mods.length)}?`}
        description={
          pendingBulk === null
            ? ''
            : pendingBulk.dependents.length > 0
              ? t`Без них не запустятся: ${pendingBulk.dependents.join(', ')}.`
              : t`Файлы удалятся из папки mods этой сборки.`
        }
        confirmLabel={t`Удалить`}
        onCancel={() => {
          setPendingBulk(null);
        }}
        onConfirm={() => {
          const mods = pendingBulk?.mods ?? [];
          setPendingBulk(null);
          void bulkRemove(mods);
        }}
      />

      <ConfirmDialog
        open={pendingRemoval !== null}
        destructive
        title={pendingRemoval === null ? '' : t`Удалить «${pendingRemoval.mod.name}»?`}
        description={
          pendingRemoval === null
            ? ''
            : t`Без него не запустятся: ${pendingRemoval.dependents.join(', ')}. Их можно удалить следом или вернуть этот мод из браузера модов.`
        }
        confirmLabel={t`Удалить всё равно`}
        onCancel={() => {
          setPendingRemoval(null);
        }}
        onConfirm={() => {
          if (pendingRemoval !== null) removeNow(pendingRemoval.mod);
          setPendingRemoval(null);
        }}
      />

      <ProjectDialog
        target={described}
        onClose={() => {
          setDescribed(null);
        }}
        actions={() => {
          const current = described;
          if (current === null || current.versionId === null) return null;
          return (
            <Button
              variant="primary"
              icon={<History size={14} strokeWidth={1.5} />}
              onClick={() => {
                setDescribed(null);
                installer.chooseVersion({
                  provider: current.provider,
                  projectId: current.projectId,
                  name: current.name,
                  currentVersionId: current.versionId,
                });
              }}
            >
              {t`Сменить версию`}</Button>
          );
        }}
      />

      {installer.dialogs}
    </div>
  );
}
