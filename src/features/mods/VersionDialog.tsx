import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { AlertTriangle, History } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBlock } from '@/components/ui/ErrorBlock';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import * as modsApi from '@/api/mods';
import type { ContentKind } from '@/api/mods';
import { formatBytes, formatRelativeDate } from '@/lib/format';
import { useAsyncData } from '@/lib/useAsyncData';
import type { Instance } from '@/types/instance';
import type { ModVersion, ProviderId } from '@/types/mod';
import { t } from '@/lib/i18n';

/** Which project the picker is open for. */
export interface VersionTarget {
  readonly provider: ProviderId;
  readonly projectId: string;
  readonly name: string;
  /** The version on disk now, if the project is installed. */
  readonly currentVersionId: string | null;
}

export interface VersionDialogProps {
  instance: Instance;
  kind: ContentKind;
  target: VersionTarget | null;
  busy: boolean;
  onPick: (version: ModVersion) => void;
  onClose: () => void;
}

const RELEASE_BADGE: Readonly<Record<ModVersion['releaseType'], string | null>> = {
  release: null,
  beta: t`бета`,
  alpha: t`альфа`,
};

/** "1.20.1, 1.20.2 … 1.20.6" — full lists run to dozens of entries. */
function gameVersionsSummary(versions: readonly string[]): string {
  if (versions.length <= 3) return versions.join(', ');
  return `${versions.slice(0, 2).join(', ')} … ${versions[versions.length - 1] ?? ''}`;
}

export function VersionDialog({
  instance,
  kind,
  target,
  busy,
  onPick,
  onClose,
}: VersionDialogProps): ReactElement {
  const [anyGameVersion, setAnyGameVersion] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  // Every opening starts from the instance's own Minecraft version.
  useEffect(() => {
    setAnyGameVersion(false);
    setSelected(null);
  }, [target?.projectId]);

  const { data, loading, error, reload } = useAsyncData<ModVersion[]>(
    () =>
      target === null
        ? Promise.resolve([])
        : modsApi.listVersions(instance.id, target.provider, target.projectId, kind, anyGameVersion),
    [instance.id, target?.provider, target?.projectId, kind, anyGameVersion],
  );

  const versions = data ?? [];
  const chosen = versions.find((version) => version.versionId === selected) ?? null;
  const foreign = chosen !== null && !chosen.gameVersions.includes(instance.mcVersion);
  const current = target?.currentVersionId ?? null;

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      width="lg"
      title={target === null ? '' : t`Версии: ${target.name}`}
      description={
        kind === 'mod'
          ? t`Показаны версии для вашего лоадера. Зависимости выбранной версии поставятся вместе с ней.`
          : t`Выберите версию — установленная будет заменена.`
      }
      busy={busy}
      footer={
        <>
          <div className="mr-auto">
            <Switch
              checked={anyGameVersion}
              onChange={setAnyGameVersion}
              label={t`Не только Minecraft ${instance.mcVersion}`}
            />
          </div>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t`Отмена`}</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={chosen === null || chosen.versionId === current || chosen.downloadUrl === ''}
            onClick={() => {
              if (chosen !== null) onPick(chosen);
            }}
          >
            {current === null ? t`Установить` : t`Поставить эту версию`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 py-2">
        {foreign && (
          <div className="flex gap-2.5 rounded-md border border-danger/35 bg-danger/5 p-3">
            <AlertTriangle size={14} strokeWidth={1.5} className="mt-px shrink-0 text-danger" />
            <p className="text-xs text-text">
              {t`Эта версия сделана для Minecraft `}{gameVersionsSummary(chosen.gameVersions)}{t`, а сборка — на`}{' '}
              {instance.mcVersion}{t`. Она может не запуститься.`}</p>
          </div>
        )}

        {error !== null ? (
          <ErrorBlock error={error} onRetry={reload} />
        ) : loading ? (
          <div className="flex flex-col gap-1.5">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-12" />
            ))}
          </div>
        ) : versions.length === 0 ? (
          <EmptyState
            compact
            icon={<History size={20} strokeWidth={1.5} />}
            title={t`Подходящих версий нет`}
            description={
              anyGameVersion
                ? undefined
                : t`Для Minecraft ${instance.mcVersion} версий нет — включите «Не только Minecraft ${instance.mcVersion}».`
            }
          />
        ) : (
          <ul role="listbox" aria-label={t`Версии`} className="flex flex-col gap-1.5">
            {versions.map((version) => {
              const isCurrent = version.versionId === current;
              const isSelected = version.versionId === selected;
              const blocked = version.downloadUrl === '';
              const release = RELEASE_BADGE[version.releaseType];
              return (
                <li key={version.versionId}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={blocked}
                    onClick={() => {
                      setSelected(version.versionId);
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left',
                      'transition-colors duration-fast ease-out disabled:opacity-45',
                      isSelected
                        ? 'border-accent bg-accent/10'
                        : 'border-transparent bg-surface-2 hover:border-border',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-mono text-xs text-text">
                          {version.versionNumber}
                        </span>
                        {release !== null && (
                          <Badge tone={version.releaseType === 'alpha' ? 'danger' : 'outline'}>
                            {release}
                          </Badge>
                        )}
                        {isCurrent && <Badge tone="accent">{t`установлена`}</Badge>}
                        {blocked && <Badge tone="danger">{t`только вручную`}</Badge>}
                      </div>
                      <p className="mt-0.5 truncate text-2xs text-text-dim">
                        {version.name !== version.versionNumber && `${version.name} · `}
                        Minecraft {gameVersionsSummary(version.gameVersions)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-2xs text-text-dim">
                        {formatRelativeDate(version.publishedAt)}
                      </p>
                      <p className="font-mono text-2xs text-text-dim">
                        {formatBytes(version.sizeBytes)}
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
