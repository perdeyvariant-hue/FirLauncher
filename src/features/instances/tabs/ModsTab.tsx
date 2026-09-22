import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { ArrowUpCircle, History, Package, Plus, Search, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBlock } from '@/components/ui/ErrorBlock';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import * as instancesApi from '@/api/instances';
import { ContentBrowser } from '@/features/mods/ContentBrowser';
import { ProjectDialog } from '@/features/mods/ProjectDialog';
import type { ProjectTarget } from '@/features/mods/ProjectDialog';
import { useContentInstaller } from '@/features/mods/useContentInstaller';
import { UpdatesBar } from '@/features/mods/UpdatesBar';
import { useContentUpdates } from '@/features/mods/useContentUpdates';
import { formatBytes } from '@/lib/format';
import { useAsyncData } from '@/lib/useAsyncData';
import type { InstalledMod, Instance } from '@/types/instance';
import { isProviderId, providerLabel } from '@/types/mod';
import { useToasts } from '@/store/useToasts';

export function ModsTab({ instance }: { instance: Instance }): ReactElement {
  const { data, loading, error, reload } = useAsyncData<InstalledMod[]>(
    () => instancesApi.listInstalledMods(instance.id),
    [instance.id],
  );
  const fail = useToasts((state) => state.fail);

  const [browsing, setBrowsing] = useState(false);
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
            placeholder="Поиск по модам"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            leading={<Search size={14} strokeWidth={1.5} />}
          />
        </div>

        <UpdatesBar state={updates} canCheck={!vanilla && mods.length > 0} />

        <div className="ml-auto flex items-center gap-2">
          {vanilla && (
            <span className="text-2xs text-text-dim">Моды работают только со сборками с лоадером</span>
          )}
          <Button
            variant="primary"
            size="sm"
            disabled={vanilla}
            icon={<Plus size={14} strokeWidth={1.5} />}
            onClick={() => {
              setBrowsing(true);
            }}
          >
            Добавить моды
          </Button>
        </div>
      </div>

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
          title={mods.length === 0 ? 'Моды не установлены' : 'Ничего не найдено'}
          description={
            mods.length === 0
              ? vanilla
                ? 'В ванильную сборку моды не ставятся — создайте сборку с Fabric, Quilt, Forge или NeoForge.'
                : 'Найдите моды на Modrinth или CurseForge и поставьте их в эту сборку в один клик.'
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
                Добавить моды
              </Button>
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
                {anyPending &&
                  (update === undefined ? (
                    <span className="w-4 shrink-0" />
                  ) : (
                    <Checkbox
                      label={`Обновить ${mod.name}`}
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

                <button
                  type="button"
                  disabled={source === null || provider === null}
                  title={provider === null ? undefined : 'Открыть описание'}
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
                    label={`Обновить до ${update.latest.versionNumber}`}
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
                    label="Сменить версию"
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
                  label="Удалить мод"
                  tone="danger"
                  size="sm"
                  icon={<Trash2 size={14} strokeWidth={1.5} />}
                  onClick={() => {
                    void instancesApi
                      .removeMod(instance.id, mod.fileName)
                      .then(() => {
                        updates.forget(mod.fileName);
                        reload();
                      })
                      .catch((raw: unknown) => fail(raw));
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}

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
              Сменить версию
            </Button>
          );
        }}
      />

      {installer.dialogs}
    </div>
  );
}
