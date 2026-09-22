import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent, ReactElement, ReactNode } from 'react';
import {
  BookOpen,
  Bug,
  CalendarClock,
  Code2,
  Download,
  Globe,
  Heart,
  MessageCircle,
  Package,
  Scale,
  Users,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { ErrorBlock } from '@/components/ui/ErrorBlock';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton } from '@/components/ui/Skeleton';
import * as modsApi from '@/api/mods';
import { openExternal } from '@/api/system';
import { renderDescription } from '@/lib/description';
import { formatCompactNumber, formatRelativeDate } from '@/lib/format';
import { useAsyncData } from '@/lib/useAsyncData';
import type { LinkKind, ModProject, ProjectDetails, ProjectLink, ProviderId } from '@/types/mod';
import { PROVIDER_LABELS } from '@/types/mod';
import { t } from '@/lib/i18n';

/** Which project to describe; `preview` fills the header while loading. */
export interface ProjectTarget {
  readonly provider: ProviderId;
  readonly projectId: string;
  readonly preview: ModProject | null;
}

export interface ProjectDialogProps {
  target: ProjectTarget | null;
  onClose: () => void;
  /** Buttons for the footer (install, versions…), given the loaded page. */
  actions?: (details: ProjectDetails | null) => ReactNode;
}

const LINK_META: Readonly<Record<LinkKind, { label: string; icon: ReactElement }>> = {
  page: { label: t`Страница`, icon: <Globe size={13} strokeWidth={1.5} /> },
  source: { label: t`Исходный код`, icon: <Code2 size={13} strokeWidth={1.5} /> },
  issues: { label: t`Сообщить об ошибке`, icon: <Bug size={13} strokeWidth={1.5} /> },
  wiki: { label: t`Вики`, icon: <BookOpen size={13} strokeWidth={1.5} /> },
  discord: { label: 'Discord', icon: <MessageCircle size={13} strokeWidth={1.5} /> },
  donation: { label: t`Поддержать`, icon: <Heart size={13} strokeWidth={1.5} /> },
};

const LOADER_NAMES: Readonly<Record<string, string>> = {
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
  iris: 'Iris',
  optifine: 'OptiFine',
  canvas: 'Canvas',
  vanilla: 'Vanilla',
};

/** "1.16.5 – 26.2 (41)": releases only, snapshots would drown the range. */
function versionRange(versions: readonly string[]): string | null {
  const releases = versions
    .filter((version) => /^\d+(\.\d+)+$/.test(version))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const first = releases[0];
  const last = releases[releases.length - 1];
  if (first === undefined || last === undefined) return null;
  return first === last ? first : `${first} – ${last} (${String(releases.length)})`;
}

function linkLabel(link: ProjectLink, provider: ProviderId): string {
  if (link.kind === 'page') return PROVIDER_LABELS[provider];
  if (link.kind === 'donation' && link.label !== '') return t`Поддержать · ${link.label}`;
  return LINK_META[link.kind].label;
}

/** Descriptions link out; nothing may navigate the app window itself. */
function openLinksExternally(event: MouseEvent<HTMLElement>): void {
  const anchor = (event.target as HTMLElement).closest('a');
  if (anchor === null) return;
  event.preventDefault();
  const href = anchor.getAttribute('href') ?? '';
  if (/^https?:\/\//i.test(href)) void openExternal(href);
}

function Icon({ url }: { url: string | null }): ReactElement {
  const [broken, setBroken] = useState(false);
  if (url === null || broken) {
    return (
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-text-dim">
        <Package size={22} strokeWidth={1.5} />
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      width={64}
      height={64}
      onError={() => {
        setBroken(true);
      }}
      className="h-16 w-16 shrink-0 rounded-xl bg-surface-2 object-cover"
    />
  );
}

function Stat({ icon, children }: { icon: ReactElement; children: ReactNode }): ReactElement {
  return (
    <span className="inline-flex items-center gap-1 text-2xs text-text-dim">
      {icon}
      {children}
    </span>
  );
}

function Gallery({ details }: { details: ProjectDetails }): ReactElement | null {
  const [open, setOpen] = useState<number | null>(null);
  if (details.gallery.length === 0) return null;
  const shown = open === null ? undefined : details.gallery[open];

  return (
    <section className="flex flex-col gap-2">
      {shown !== undefined && (
        <figure className="relative overflow-hidden rounded-lg border border-border bg-surface-2">
          <img
            src={shown.fullUrl}
            alt={shown.title ?? ''}
            referrerPolicy="no-referrer"
            className="max-h-[420px] w-full object-contain"
          />
          <div className="absolute right-2 top-2">
            <IconButton
              label={t`Закрыть изображение`}
              size="sm"
              icon={<X size={14} strokeWidth={1.5} />}
              onClick={() => {
                setOpen(null);
              }}
              className="bg-surface/80"
            />
          </div>
          {(shown.title !== null || shown.description !== null) && (
            <figcaption className="px-3 py-2">
              {shown.title !== null && <p className="text-xs text-text">{shown.title}</p>}
              {shown.description !== null && (
                <p className="mt-0.5 text-2xs text-text-dim">{shown.description}</p>
              )}
            </figcaption>
          )}
        </figure>
      )}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {details.gallery.map((image, index) => (
          <button
            key={image.fullUrl}
            type="button"
            aria-label={image.title ?? t`Изображение ${String(index + 1)}`}
            onClick={() => {
              setOpen(index === open ? null : index);
            }}
            className={cn(
              'h-20 w-32 shrink-0 overflow-hidden rounded-md border bg-surface-2',
              'transition-colors duration-fast ease-out',
              index === open ? 'border-accent' : 'border-border hover:border-text-dim',
            )}
          >
            <img
              src={image.url}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          </button>
        ))}
      </div>
    </section>
  );
}

export function ProjectDialog({ target, onClose, actions }: ProjectDialogProps): ReactElement {
  const { data, loading, error, reload } = useAsyncData<ProjectDetails | null>(
    () =>
      target === null
        ? Promise.resolve(null)
        : modsApi.projectDetails(target.provider, target.projectId),
    [target?.provider, target?.projectId],
  );
  // A stale page from the previous project must not flash in.
  const details = data !== null && data.project.projectId === target?.projectId ? data : null;
  const project = details?.project ?? target?.preview ?? null;

  const html = useMemo(
    () => (details === null ? '' : renderDescription(details.body, details.bodyFormat)),
    [details],
  );

  // Scroll back to the top when switching projects.
  const [bodyKey, setBodyKey] = useState(0);
  useEffect(() => {
    setBodyKey((value) => value + 1);
  }, [target?.projectId]);

  const range = details === null ? null : versionRange(details.gameVersions);
  const loaders = (details?.loaders ?? [])
    .map((loader) => LOADER_NAMES[loader])
    .filter((name): name is string => name !== undefined);

  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      width="xl"
      title={project?.name ?? t`Загрузка…`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t`Закрыть`}</Button>
          {actions?.(details)}
        </>
      }
    >
      <div key={bodyKey} className="flex flex-col gap-4 pb-2">
        {project !== null && (
          <header className="flex gap-4">
            <Icon url={project.iconUrl} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="selectable text-sm leading-relaxed text-text-dim">{project.summary}</p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {project.author !== '' && (
                  <span className="text-2xs text-text">
                    <span className="text-text-dim">{t`автор`}</span> {project.author}
                  </span>
                )}
                <Stat icon={<Download size={11} strokeWidth={1.5} />}>
                  {formatCompactNumber(project.downloads)}
                </Stat>
                {project.followers !== null && (
                  <Stat icon={<Users size={11} strokeWidth={1.5} />}>
                    {formatCompactNumber(project.followers)}
                  </Stat>
                )}
                {project.updatedAt !== null && (
                  <Stat icon={<CalendarClock size={11} strokeWidth={1.5} />}>
                    {t`обновлён `}{formatRelativeDate(project.updatedAt)}
                  </Stat>
                )}
                {project.license !== null && (
                  <Stat icon={<Scale size={11} strokeWidth={1.5} />}>{project.license}</Stat>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {range !== null && <Badge tone="outline">Minecraft {range}</Badge>}
                {loaders.map((loader) => (
                  <Badge key={loader} tone="neutral">
                    {loader}
                  </Badge>
                ))}
                {project.categories.slice(0, 8).map((category) => (
                  <Badge key={category} tone="outline">
                    {category}
                  </Badge>
                ))}
              </div>
            </div>
          </header>
        )}

        {details !== null && details.links.length > 0 && target !== null && (
          <nav className="flex flex-wrap gap-1.5">
            {details.links.map((link) => (
              <Button
                key={`${link.kind}-${link.url}`}
                size="sm"
                variant={link.kind === 'donation' ? 'primary' : 'secondary'}
                icon={LINK_META[link.kind].icon}
                onClick={() => {
                  void openExternal(link.url);
                }}
              >
                {linkLabel(link, target.provider)}
              </Button>
            ))}
          </nav>
        )}

        {error !== null ? (
          <ErrorBlock error={error} onRetry={reload} />
        ) : loading || details === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-20" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ) : (
          <>
            <Gallery details={details} />
            {html.trim() === '' ? (
              <p className="text-xs text-text-dim">{t`Автор не добавил описания.`}</p>
            ) : (
              <article
                className="description selectable"
                onClick={openLinksExternally}
                // Sanitised in renderDescription: markup only, no scripts,
                // handlers, styles or embeds.
                dangerouslySetInnerHTML={{ __html: html }}
              />
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
