import type { ReactElement } from 'react';
import { Globe2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBlock } from '@/components/ui/ErrorBlock';
import { Skeleton } from '@/components/ui/Skeleton';
import * as instancesApi from '@/api/instances';
import { formatBytes, formatRelativeDate } from '@/lib/format';
import { useAsyncData } from '@/lib/useAsyncData';
import type { Instance, WorldEntry } from '@/types/instance';

export function WorldsTab({ instance }: { instance: Instance }): ReactElement {
  const { data, loading, error, reload } = useAsyncData<WorldEntry[]>(
    () => instancesApi.listWorlds(instance.id),
    [instance.id],
  );

  if (error !== null) return <ErrorBlock error={error} onRetry={reload} />;

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-14" />
        ))}
      </div>
    );
  }

  const worlds = data ?? [];
  if (worlds.length === 0) {
    return (
      <EmptyState
        compact
        icon={<Globe2 size={20} strokeWidth={1.5} />}
        title="Миров пока нет"
        description="Созданные в игре миры появятся здесь автоматически."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {worlds.map((world) => (
        <li key={world.folderName} className="panel flex items-center gap-3 p-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-dim">
            <Globe2 size={16} strokeWidth={1.5} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-text">{world.name}</p>
            <p className="mt-0.5 truncate font-mono text-2xs text-text-dim">{world.folderName}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-2xs text-text-dim">{world.gameMode ?? '—'}</p>
            <p className="text-2xs text-text-dim">
              {formatBytes(world.sizeBytes)} · {formatRelativeDate(world.lastPlayedAt)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
