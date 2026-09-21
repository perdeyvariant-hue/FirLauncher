import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { ArrowUpCircle, Package, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBlock } from '@/components/ui/ErrorBlock';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import * as instancesApi from '@/api/instances';
import * as modsApi from '@/api/mods';
import { ContentBrowser } from '@/features/mods/ContentBrowser';
import { formatBytes } from '@/lib/format';
import { useAsyncData } from '@/lib/useAsyncData';
import type { InstalledMod, Instance } from '@/types/instance';
import type { ModUpdate, ProviderId } from '@/types/mod';
import { PROVIDER_LABELS } from '@/types/mod';
import { useToasts } from '@/store/useToasts';

function providerLabel(provider: string): string {
  return provider in PROVIDER_LABELS ? PROVIDER_LABELS[provider as ProviderId] : provider;
}

export function ModsTab({ instance }: { instance: Instance }): ReactElement {
  const { data, loading, error, reload } = useAsyncData<InstalledMod[]>(
    () => instancesApi.listInstalledMods(instance.id),
    [instance.id],
  );
  const notify = useToasts((state) => state.notify);
  const fail = useToasts((state) => state.fail);

  const [browsing, setBrowsing] = useState(false);
  const [search, setSearch] = useState('');
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [updates, setUpdates] = useState<Map<string, ModUpdate>>(new Map());
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState<Set<string>>(new Set());

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
        setUpdates((current) => {
          const update = current.get(mod.fileName);
          if (update === undefined) return current;
          const next = new Map(current);
          next.delete(mod.fileName);
          next.set(renamed, { ...update, fileName: renamed });
          return next;
        });
        reload();
      })
      .catch((raw: unknown) => {
        setOverrides((current) => ({ ...current, [mod.fileName]: !enabled }));
        fail(raw);
      });
  };

  const checkUpdates = async (): Promise<void> => {
    setChecking(true);
    try {
      const found = await modsApi.checkModUpdates(instance.id);
      setUpdates(new Map(found.map((update) => [update.fileName, update])));
      notify(
        found.length === 0 ? 'Все моды актуальны' : `Есть обновления: ${String(found.length)}`,
        found.length === 0 ? 'success' : 'info',
      );
      // The check may have identified hand-added files; show their source.
      reload();
    } catch (raw) {
      fail(raw, () => void checkUpdates());
    }
    setChecking(false);
  };

  const applyUpdates = async (selected: ModUpdate[]): Promise<void> => {
    const names = selected.map((update) => update.fileName);
    setUpdating((current) => new Set([...current, ...names]));
    try {
      await modsApi.applyModUpdates(instance.id, selected);
      setUpdates((current) => {
        const next = new Map(current);
        for (const name of names) next.delete(name);
        return next;
      });
      notify(
        selected.length === 1 ? 'Мод обновлён' : `Обновлено модов: ${String(selected.length)}`,
        'success',
      );
      reload();
    } catch (raw) {
      fail(raw);
    }
    setUpdating((current) => {
      const next = new Set(current);
      for (const name of names) next.delete(name);
      return next;
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

  const pending = [...updates.values()];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
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

        {!vanilla && mods.length > 0 && (
          <Button
            size="sm"
            loading={checking}
            icon={<RefreshCw size={13} strokeWidth={1.5} />}
            onClick={() => {
              void checkUpdates();
            }}
          >
            Проверить обновления
          </Button>
        )}

        {pending.length > 0 && (
          <Button
            size="sm"
            variant="primary"
            loading={updating.size > 0}
            icon={<ArrowUpCircle size={14} strokeWidth={1.5} />}
            onClick={() => {
              void applyUpdates(pending);
            }}
          >
            Обновить все ({pending.length})
          </Button>
        )}

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
            const update = updates.get(mod.fileName);
            const newer = update?.latest.versionNumber ?? mod.updateAvailable;
            return (
              <li
                key={mod.fileName}
                className="panel flex items-center gap-3 p-3 transition-[border-color] duration-fast ease-out hover:border-text-dim/35"
              >
                <Switch
                  checked={isEnabled(mod)}
                  onChange={(value) => {
                    toggle(mod, value);
                  }}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm text-text">{mod.name}</p>
                    {mod.version !== null && <Badge tone="outline">{mod.version}</Badge>}
                    {newer !== null && <Badge tone="accent">→ {newer}</Badge>}
                    {mod.source !== null && (
                      <Badge tone="neutral">{providerLabel(mod.source.provider)}</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-2xs text-text-dim">
                    {mod.fileName} · {formatBytes(mod.sizeBytes)}
                  </p>
                </div>

                {update !== undefined && (
                  <IconButton
                    label={`Обновить до ${update.latest.versionNumber}`}
                    size="sm"
                    disabled={updating.has(mod.fileName)}
                    icon={<ArrowUpCircle size={14} strokeWidth={1.5} />}
                    onClick={() => {
                      void applyUpdates([update]);
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
                      .then(reload)
                      .catch((raw: unknown) => fail(raw));
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
