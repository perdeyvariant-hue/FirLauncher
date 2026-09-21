import { useState } from 'react';
import type { ReactElement } from 'react';
import { Layers, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBlock } from '@/components/ui/ErrorBlock';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton } from '@/components/ui/Skeleton';
import * as instancesApi from '@/api/instances';
import * as modsApi from '@/api/mods';
import { ContentBrowser } from '@/features/mods/ContentBrowser';
import { formatBytes } from '@/lib/format';
import { useAsyncData } from '@/lib/useAsyncData';
import type { Instance, ResourcePackEntry } from '@/types/instance';
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
      <div className="flex items-center justify-between gap-3">
        <p className="text-2xs text-text-dim">
          {kind === 'shader' ? copy.hint : `Файлы лежат в папке ${copy.folder} этой сборки.`}
        </p>
        {addButton}
      </div>

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
          {packs.map((pack) => (
            <li key={pack.fileName} className="panel flex items-center gap-3 p-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-dim">
                <Icon size={16} strokeWidth={1.5} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm text-text">{pack.name}</p>
                  {pack.packFormat !== null && <Badge tone="outline">format {pack.packFormat}</Badge>}
                </div>
                <p className="mt-0.5 truncate text-2xs text-text-dim">
                  {pack.description ?? pack.fileName}
                </p>
              </div>
              <span className="shrink-0 font-mono text-2xs text-text-dim">
                {formatBytes(pack.sizeBytes)}
              </span>
              <IconButton
                label="Удалить"
                tone="danger"
                size="sm"
                icon={<Trash2 size={14} strokeWidth={1.5} />}
                onClick={() => {
                  void modsApi
                    .removeContent(instance.id, kind, pack.fileName)
                    .then(reload)
                    .catch((raw: unknown) => fail(raw));
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
