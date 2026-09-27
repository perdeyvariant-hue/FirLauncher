import { useMemo } from 'react';
import type { ReactElement } from 'react';
import { ArrowUpCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { ErrorBlock } from '@/components/ui/ErrorBlock';
import { Skeleton } from '@/components/ui/Skeleton';
import * as modsApi from '@/api/mods';
import type { ChangelogEntry } from '@/api/mods';
import { renderDescription } from '@/lib/description';
import { formatRelativeDate } from '@/lib/format';
import { useAsyncData } from '@/lib/useAsyncData';
import type { ProjectKind, ProviderId } from '@/types/mod';
import { t } from '@/lib/i18n';

export interface ChangelogTarget {
  readonly instanceId: string;
  readonly kind: ProjectKind;
  readonly provider: ProviderId;
  readonly projectId: string;
  readonly installedVersionId: string | null;
  readonly name: string;
  readonly current: string | null;
  readonly newest: string;
}

function Entry({ entry, provider }: { entry: ChangelogEntry; provider: ProviderId }): ReactElement {
  // Modrinth writes Markdown, CurseForge HTML; both go through the sanitiser.
  const html = useMemo(
    () =>
      entry.text === null
        ? null
        : renderDescription(entry.text, provider === 'curseforge' ? 'html' : 'markdown'),
    [entry.text, provider],
  );
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline gap-2">
        <h3 className="font-mono text-xs font-semibold text-text">{entry.versionNumber}</h3>
        <span className="text-2xs text-text-dim">{formatRelativeDate(entry.publishedAt)}</span>
      </header>
      {html === null ? (
        <p className="text-xs text-text-dim">{t`Автор ничего не написал об этой версии.`}</p>
      ) : (
        // Sanitised by renderDescription: only plain document markup survives.
        <div className="description selectable" dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </section>
  );
}

/** Every version newer than the installed one, in the author's own words. */
export function ChangelogDialog({
  target,
  onClose,
  onUpdate,
}: {
  target: ChangelogTarget | null;
  onClose: () => void;
  /** Present when the update can be applied from here. */
  onUpdate?: () => void;
}): ReactElement {
  const notes = useAsyncData<ChangelogEntry[]>(
    () =>
      target === null
        ? Promise.resolve([])
        : modsApi.updateChangelogs(
            target.instanceId,
            target.kind,
            target.provider,
            target.projectId,
            target.installedVersionId,
          ),
    [target?.instanceId, target?.projectId, target?.installedVersionId],
  );

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      width="md"
      title={target === null ? '' : t`Что нового в «${target.name}»`}
      description={
        target === null
          ? undefined
          : target.current === null
            ? target.newest
            : `${target.current} → ${target.newest}`
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t`Закрыть`}</Button>
          {onUpdate !== undefined && target !== null && (
            <Button
              variant="primary"
              icon={<ArrowUpCircle size={14} strokeWidth={1.5} />}
              onClick={() => {
                onUpdate();
                onClose();
              }}
            >
              {t`Обновить до ${target.newest}`}</Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-5 py-2">
        {notes.error !== null ? (
          <ErrorBlock error={notes.error} onRetry={notes.reload} />
        ) : notes.loading || notes.data === null ? (
          Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-16" />)
        ) : notes.data.length === 0 ? (
          <p className="text-xs text-text-dim">{t`Не нашлось версий новее установленной.`}</p>
        ) : (
          notes.data.map((entry) => (
            <Entry key={entry.versionNumber} entry={entry} provider={target?.provider ?? 'modrinth'} />
          ))
        )}
      </div>
    </Dialog>
  );
}
