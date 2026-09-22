import type { ReactElement } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBlock } from '@/components/ui/ErrorBlock';
import { Skeleton } from '@/components/ui/Skeleton';
import * as instancesApi from '@/api/instances';
import { formatBytes, formatRelativeDate } from '@/lib/format';
import { useAsyncData } from '@/lib/useAsyncData';
import type { Instance, ScreenshotEntry } from '@/types/instance';
import { t } from '@/lib/i18n';

export function ScreenshotsTab({ instance }: { instance: Instance }): ReactElement {
  const { data, loading, error, reload } = useAsyncData<ScreenshotEntry[]>(
    () => instancesApi.listScreenshots(instance.id),
    [instance.id],
  );

  if (error !== null) return <ErrorBlock error={error} onRetry={reload} />;

  if (loading) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="aspect-video" />
        ))}
      </div>
    );
  }

  const shots = data ?? [];
  if (shots.length === 0) {
    return (
      <EmptyState
        compact
        icon={<ImageIcon size={20} strokeWidth={1.5} />}
        title={t`Скриншотов нет`}
        description={t`Нажмите F2 в игре — снимки появятся здесь.`}
      />
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
      {shots.map((shot) => (
        <figure
          key={shot.fileName}
          className="panel overflow-hidden transition-[border-color] duration-fast ease-out hover:border-text-dim/35"
        >
          {/* Stage 2 replaces this with a convertFileSrc() thumbnail. */}
          <div className="flex aspect-video items-center justify-center bg-surface-2 text-text-dim">
            <ImageIcon size={20} strokeWidth={1.5} />
          </div>
          <figcaption className="p-2.5">
            <p className="truncate font-mono text-2xs text-text">{shot.fileName}</p>
            <p className="mt-0.5 text-2xs text-text-dim">
              {formatRelativeDate(shot.takenAt)} · {formatBytes(shot.sizeBytes)}
            </p>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
