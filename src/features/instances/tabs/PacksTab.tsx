import { useState } from 'react';
import type { ReactElement } from 'react';
import { ArrowUpCircle, History, Layers, Plus, Sparkles, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBlock } from '@/components/ui/ErrorBlock';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton } from '@/components/ui/Skeleton';
import * as instancesApi from '@/api/instances';
import * as modsApi from '@/api/mods';
import { ContentBrowser } from '@/features/mods/ContentBrowser';
import { ProjectDialog } from '@/features/mods/ProjectDialog';
import type { ProjectTarget } from '@/features/mods/ProjectDialog';
import { useContentInstaller } from '@/features/mods/useContentInstaller';
import { UpdatesBar } from '@/features/mods/UpdatesBar';
import { useContentUpdates } from '@/features/mods/useContentUpdates';
import { formatBytes } from '@/lib/format';
import { useAsyncData } from '@/lib/useAsyncData';
import type { Instance, ResourcePackEntry } from '@/types/instance';
import { isProviderId, providerLabel } from '@/types/mod';
import { useToasts } from '@/store/useToasts';

export type PackKind = 'resourcepack' | 'shader';

const COPY: Readonly<
  Record<PackKind, { add: string; empty: string; hint: string; folder: string }>
> = {
  resourcepack: {
    add: 'Добавить ресурспаки',
    empty: 'Ресурспаков нет',
    hint: 'Найдите ресурспак на Modrinth или CurseForge — или положите .zip в папку resourcepacks.',
    folder: 'resourcepacks',
  },
  shader: {
    add: 'Добавить шейдеры',
    empty: 'Шейдеров нет',
    hint: 'Для шейдеров нужен Iris (Fabric, Quilt) или Oculus (Forge, NeoForge) — поставьте его во вкладке «Моды».',
    folder: 'shaderpacks',
  },
};

export function PacksTab({ instance, kind }: { instance: Instance; kind: PackKind }): ReactElement {
  const copy = COPY[kind];
  const { data, loading, error, reload } = useAsyncData<ResourcePackEntry[]>(
    () =>
      kind === 'shader'
        ? instancesApi.listShaderPacks(instance.id)
        : instancesApi.listResourcePacks(instance.id),
    [instance.id, kind],
  );
  const fail = useToasts((state) => state.fail);
  const [browsing, setBrowsing] = useState(false);
  // The installed file whose description is open.
  const [described, setDescribed] = useState<
    (ProjectTarget & { readonly name: string; readonly versionId: string | null }) | null
  >(null);

  const updates = useContentUpdates(instance.id, kind, reload);
  const installer = useContentInstaller(instance, kind, (plan) => {
    for (const pack of data ?? []) {
      if (pack.source?.projectId === plan.primary.projectId) updates.forget(pack.fileName);
    }
    reload();
  });

  if (browsing) {
    return (
      <ContentBrowser
        instance={instance}
        kind={kind}
        onBack={() => {
          setBrowsing(false);
        }}
        onInstalled={reload}
      />
    );
  }

  if (error !== null) return <ErrorBlock error={error} onRetry={reload} />;

  const packs = data ?? [];
  const anyPending = updates.updates.size > 0;
  const Icon = kind === 'shader' ? Sparkles : Layers;
  const addButton = (
    <Button
      variant="primary"
      size="sm"
      icon={<Plus size={14} strokeWidth={1.5} />}
      onClick={() => {
        setBrowsing(true);
      }}
    >
      {copy.add}
    </Button>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <UpdatesBar state={updates} canCheck={packs.length > 0} />
        <div className="ml-auto">{addButton}</div>
      </div>
      <p className="text-2xs text-text-dim">
        {kind === 'shader' ? copy.hint : `Файлы лежат в папке ${copy.folder} этой сборки.`}
      </p>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 2 }, (_, index) => (
            <Skeleton key={index} className="h-14" />
          ))}
        </div>
      ) : packs.length === 0 ? (
        <EmptyState
          compact
          icon={<Icon size={20} strokeWidth={1.5} />}
          title={copy.empty}
          description={kind === 'shader' ? undefined : copy.hint}
          action={addButton}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {packs.map((pack) => {
            const update = updates.updates.get(pack.fileName);
            const source = pack.source;
            const provider =
              source !== null && isProviderId(source.provider) ? source.provider : null;
            return (
              <li key={pack.fileName} className="panel flex items-center gap-3 p-3">
                {anyPending &&
                  (update === undefined ? (
                    <span className="w-4 shrink-0" />
                  ) : (
                    <Checkbox
                      label={`Обновить ${pack.name}`}
                      checked={updates.selected.has(pack.fileName)}
                      disabled={updates.updating.has(pack.fileName)}
                      onChange={(on) => {
                        updates.setSelected(pack.fileName, on);
                      }}
                    />
                  ))}

                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-dim">
                  <Icon size={16} strokeWidth={1.5} />
                </span>
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
                      name: pack.name,
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
                      {pack.name}
                    </p>
                    {source !== null && <Badge tone="outline">{source.versionNumber}</Badge>}
                    {update !== undefined && (
                      <Badge tone="accent">→ {update.latest.versionNumber}</Badge>
                    )}
                    {source !== null && (
                      <Badge tone="neutral">{providerLabel(source.provider)}</Badge>
                    )}
                    {source === null && pack.packFormat !== null && (
                      <Badge tone="outline">format {pack.packFormat}</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-2xs text-text-dim">
                    {pack.description ?? pack.fileName}
                  </p>
                </button>
                <span className="shrink-0 font-mono text-2xs text-text-dim">
                  {formatBytes(pack.sizeBytes)}
                </span>

                {update !== undefined && (
                  <IconButton
                    label={`Обновить до ${update.latest.versionNumber}`}
                    size="sm"
                    disabled={updates.updating.has(pack.fileName)}
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
                        name: pack.name,
                        currentVersionId: source.versionId,
                      });
                    }}
                  />
                )}

                <IconButton
                  label="Удалить"
                  tone="danger"
                  size="sm"
                  icon={<Trash2 size={14} strokeWidth={1.5} />}
                  onClick={() => {
                    void modsApi
                      .removeContent(instance.id, kind, pack.fileName)
                      .then(() => {
                        updates.forget(pack.fileName);
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
