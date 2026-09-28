import { useMemo } from 'react';
import type { CSSProperties, MouseEvent, ReactElement } from 'react';
import { Play, Square, Star } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/Badge';
import { ContextMenu } from '@/components/ui/ContextMenu';
import type { ContextMenuItem } from '@/components/ui/ContextMenu';
import { artGradient, artIndexOf } from '@/lib/art';
import { formatPlaytime, formatRelativeDate, initialsOf } from '@/lib/format';
import { Glyph, LETTERS, glyphOf } from '@/lib/glyphs';
import { translate } from '@/lib/i18n';
import { useTasks } from '@/store/useTasks';
import type { Instance } from '@/types/instance';
import { LOADER_LABELS } from '@/types/instance';
import type { Task } from '@/types/task';
import { t } from '@/lib/i18n';

export interface InstanceCardActions {
  onOpen: (id: string) => void;
  onPlay: (id: string) => void;
  onStop: (id: string) => void;
  onOpenFolder: (id: string) => void;
  onDuplicate: (id: string) => void;
  onExport: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onChooseGroup: (id: string) => void;
  onShortcut: (id: string) => void;
}

export interface InstanceCardProps extends InstanceCardActions {
  instance: Instance;
  /** Position in the grid, for the staggered entrance. */
  index?: number;
}

export function coverOf(instance: Pick<Instance, 'id' | 'color'>): string {
  return artGradient(instance.color ?? artIndexOf(instance.id));
}

export function loaderLabel(instance: Instance): string {
  if (instance.loader === 'vanilla') return 'Vanilla';
  const version = instance.loaderVersion === null ? '' : ` ${instance.loaderVersion}`;
  return `${LOADER_LABELS[instance.loader]}${version}`;
}

/** The install or launch-preparation task running for this instance, if any. */
export function useInstanceTask(instanceId: string): Task | null {
  const tasks = useTasks((state) => state.tasks);
  return useMemo(
    () =>
      tasks.find(
        (task) =>
          task.instanceId === instanceId && (task.state === 'running' || task.state === 'queued'),
      ) ?? null,
    [tasks, instanceId],
  );
}

export function instanceMenu(instance: Instance, actions: InstanceCardActions): ContextMenuItem[] {
  const running = instance.status.state === 'running';
  return [
    {
      id: 'play',
      label: running ? t`Остановить` : t`Играть`,
      onSelect: () => {
        if (running) actions.onStop(instance.id);
        else actions.onPlay(instance.id);
      },
    },
    {
      id: 'open',
      label: t`Открыть сборку`,
      onSelect: () => {
        actions.onOpen(instance.id);
      },
    },
    {
      id: 'folder',
      label: t`Открыть папку`,
      onSelect: () => {
        actions.onOpenFolder(instance.id);
      },
    },
    {
      id: 'duplicate',
      label: t`Дублировать`,
      onSelect: () => {
        actions.onDuplicate(instance.id);
      },
    },
    {
      id: 'favorite',
      label: instance.favorite ? t`Убрать из избранного` : t`В избранное`,
      onSelect: () => {
        actions.onToggleFavorite(instance.id);
      },
    },
    {
      id: 'group',
      label: t`Группа…`,
      onSelect: () => {
        actions.onChooseGroup(instance.id);
      },
    },
    {
      id: 'shortcut',
      label: t`Ярлык на рабочий стол`,
      onSelect: () => {
        actions.onShortcut(instance.id);
      },
    },
    {
      id: 'export',
      label: t`Экспорт`,
      onSelect: () => {
        actions.onExport(instance.id);
      },
    },
    {
      id: 'delete',
      label: t`Удалить`,
      tone: 'danger',
      separatorBefore: true,
      onSelect: () => {
        actions.onDelete(instance.id);
      },
    },
  ];
}

/** Cover art: the instance's own icon, else its picture (or initials) on its gradient. */
export function Cover({
  instance,
  size,
  className,
  style,
}: {
  instance: Pick<Instance, 'id' | 'name' | 'color' | 'glyph' | 'iconPath'>;
  size: 'tile' | 'row' | 'hero';
  className?: string;
  style?: CSSProperties;
}): ReactElement {
  const initialsSize = size === 'tile' ? 'text-[30px]' : size === 'hero' ? 'text-[19px]' : 'text-[13px]';
  const iconSize = size === 'tile' ? 64 : size === 'hero' ? 40 : 30;
  const glyphSize = size === 'tile' ? 46 : size === 'hero' ? 30 : 20;
  const glyph = glyphOf(instance);
  return (
    <div
      className={cn(
        'relative grid place-items-center overflow-hidden',
        'shadow-[inset_0_1px_0_rgb(255_255_255/0.35),inset_0_-20px_40px_rgb(0_0_0/0.18)]',
        className,
      )}
      style={{ background: coverOf(instance), ...style }}
    >
      {instance.iconPath === null && glyph !== LETTERS ? (
        <Glyph
          id={glyph}
          size={glyphSize}
          strokeWidth={size === 'tile' ? 1.6 : 1.9}
          className="text-white/95 drop-shadow-[0_2px_8px_rgb(0_0_0/0.3)]"
        />
      ) : instance.iconPath === null ? (
        <span
          className={cn(
            'font-mono font-bold leading-none text-white/90 [text-shadow:0_2px_8px_rgb(0_0_0/0.25)]',
            initialsSize,
          )}
        >
          {initialsOf(instance.name)}
        </span>
      ) : (
        <img
          src={instance.iconPath}
          alt=""
          width={iconSize}
          height={iconSize}
          className="pixelated rounded-[12%] object-cover drop-shadow-[0_4px_10px_rgb(0_0_0/0.35)]"
          style={{ width: iconSize, height: iconSize }}
        />
      )}
    </div>
  );
}

/** A green dot with a ring spreading out of it. */
export function LiveDot(): ReactElement {
  return (
    <span className="relative inline-block h-[7px] w-[7px] shrink-0">
      <span className="absolute inset-0 animate-pulse-ring rounded-full bg-[#4ade80]" />
      <span className="absolute inset-0 rounded-full bg-[#4ade80]" />
    </span>
  );
}

function reduceMotion(): boolean {
  return (
    document.documentElement.classList.contains('reduce-motion') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * A tile in the instance grid. The cover leans toward the pointer and a soft
 * light follows it; the play button rises out of the cover on hover.
 */
export function InstanceCard({ instance, index = 0, ...actions }: InstanceCardProps): ReactElement {
  const running = instance.status.state === 'running';
  const task = useInstanceTask(instance.id);
  const busy = task !== null;

  const onMove = (event: MouseEvent<HTMLElement>): void => {
    const card = event.currentTarget;
    const box = card.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    card.style.setProperty('--mx', `${String(x * 100)}%`);
    card.style.setProperty('--my', `${String(y * 100)}%`);
    card.style.setProperty('--ho', '1');
    if (!reduceMotion()) {
      card.style.transform = `perspective(900px) translateY(-3px) rotateX(${((0.5 - y) * 6).toFixed(2)}deg) rotateY(${((x - 0.5) * 6).toFixed(2)}deg)`;
    }
  };
  const onLeave = (event: MouseEvent<HTMLElement>): void => {
    event.currentTarget.style.transform = '';
    event.currentTarget.style.setProperty('--ho', '0');
  };
  const primary = (event: MouseEvent): void => {
    event.stopPropagation();
    if (running) actions.onStop(instance.id);
    else actions.onPlay(instance.id);
  };

  return (
    <ContextMenu items={instanceMenu(instance, actions)} title={instance.name}>
      <article
        tabIndex={0}
        role="button"
        aria-label={instance.name}
        onClick={() => {
          actions.onOpen(instance.id);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            actions.onOpen(instance.id);
          }
        }}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        className="glass stagger group relative cursor-pointer overflow-hidden rounded-xl px-2.5 pb-3.5 pt-2.5 transition-transform duration-spring ease-spring"
        style={{ '--i': index } as CSSProperties}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 transition-opacity duration-slow"
          style={{
            opacity: 'var(--ho, 0)',
            background:
              'radial-gradient(260px circle at var(--mx, 50%) var(--my, 50%), rgb(255 255 255 / 0.16), transparent 60%)',
          }}
        />

        <Cover
          instance={instance}
          size="tile"
          className="aspect-[16/10]"
          style={{ borderRadius: 'calc(var(--radius) - 8px)' }}
        />

        <div className="pointer-events-none absolute inset-x-2.5 top-2.5 grid aspect-[16/10] place-items-center">
          {!busy && (
            <button
              type="button"
              aria-label={running ? t`Остановить` : t`Играть`}
              onClick={primary}
              className={cn(
                'pointer-events-auto grid h-[52px] w-[52px] place-items-center rounded-full',
                'border border-white/60 bg-white/[0.28] backdrop-blur-md backdrop-saturate-[1.8]',
                'shadow-[0_8px_24px_rgb(0_0_0/0.3),inset_0_1px_0_rgb(255_255_255/0.7)]',
                'scale-[0.6] opacity-0 transition-[opacity,transform] duration-spring ease-spring',
                'group-hover:scale-100 group-hover:opacity-100 focus-visible:scale-100 focus-visible:opacity-100',
              )}
            >
              {running ? (
                <Square size={18} fill="#fff" stroke="none" />
              ) : (
                <Play size={20} fill="#fff" stroke="none" className="ml-0.5" />
              )}
            </button>
          )}
        </div>

        {running && (
          <div className="absolute left-[18px] top-[18px] flex h-6 items-center gap-[7px] rounded-pill bg-[rgb(10_30_18/0.55)] px-2.5 text-[11px] font-semibold text-[#bbf7d0] backdrop-blur-[10px]">
            <LiveDot />
            {t`Запущена`}
          </div>
        )}
        {instance.favorite && (
          <Star
            size={14}
            aria-label={t`В избранном`}
            className="absolute right-[18px] top-[18px] fill-white text-white drop-shadow-[0_1px_3px_rgb(0_0_0/0.4)]"
          />
        )}

        <div className="relative px-1 pt-3">
          <h3 className="truncate text-[14.5px] font-semibold tracking-[-0.01em] text-text">
            {instance.name}
          </h3>
          <div className="mt-[7px] flex flex-wrap gap-1.5">
            <Badge tone="outline">{instance.mcVersion}</Badge>
            <Badge>{loaderLabel(instance)}</Badge>
          </div>

          {task !== null ? (
            <div className="mt-3">
              <div className="flex justify-between gap-2 text-[11.5px] text-text-dim">
                <span className="truncate">{translate(task.stage) || t`Подготовка`}</span>
                <span className="shrink-0 font-mono">
                  {task.progress === null ? '…' : `${String(Math.floor(task.progress * 100))}%`}
                </span>
              </div>
              <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-pill bg-[var(--track)]">
                <div
                  className="relative h-full overflow-hidden rounded-pill bg-[image:var(--accent-gradient)] transition-[width] duration-slow ease-linear"
                  style={{ width: `${String((task.progress ?? 0.05) * 100)}%` }}
                >
                  <span className="absolute inset-y-0 w-2/5 animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent" />
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex justify-between gap-2 text-[11.5px] text-text-faint">
              <span className="truncate">
                {running ? t`Сейчас` : formatRelativeDate(instance.lastPlayedAt)}
              </span>
              <span className="shrink-0">
                {instance.totalPlaySeconds > 0 ? formatPlaytime(instance.totalPlaySeconds) : '—'}
              </span>
            </div>
          )}
        </div>
      </article>
    </ContextMenu>
  );
}

/** The same instance as a row, for the list view. */
export function InstanceRow({ instance, index = 0, ...actions }: InstanceCardProps): ReactElement {
  const running = instance.status.state === 'running';
  const task = useInstanceTask(instance.id);

  return (
    <ContextMenu items={instanceMenu(instance, actions)} title={instance.name}>
      <div
        tabIndex={0}
        role="button"
        aria-label={instance.name}
        onClick={() => {
          actions.onOpen(instance.id);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            actions.onOpen(instance.id);
          }
        }}
        className="stagger relative flex cursor-pointer items-center gap-3.5 px-3.5 py-2.5 shadow-[inset_0_-1px_0_var(--sep)] transition-colors duration-fast hover:bg-[var(--hover)]"
        style={{ '--i': index } as CSSProperties}
      >
        <Cover instance={instance} size="row" className="h-10 w-10 shrink-0 rounded-[12px]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-text">
            <span className="truncate">{instance.name}</span>
            {instance.favorite && <Star size={12} className="shrink-0 fill-accent text-accent" />}
            {running && <LiveDot />}
          </div>
          <div className="mt-[3px] truncate text-xs text-text-dim">
            {instance.mcVersion} · {loaderLabel(instance)}
          </div>
        </div>

        {task !== null ? (
          <div className="w-40 shrink-0">
            <div className="mb-[5px] truncate text-[11px] text-text-dim">
              {translate(task.stage) || t`Подготовка`}
              {task.progress !== null && ` · ${String(Math.floor(task.progress * 100))}%`}
            </div>
            <div className="h-[5px] overflow-hidden rounded-pill bg-[var(--track)]">
              <div
                className="relative h-full overflow-hidden bg-[image:var(--accent-gradient)] transition-[width] duration-slow ease-linear"
                style={{ width: `${String((task.progress ?? 0.05) * 100)}%` }}
              >
                <span className="absolute inset-y-0 w-2/5 animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent" />
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="w-[130px] shrink-0 truncate text-xs text-text-faint">
              {running ? t`Сейчас` : formatRelativeDate(instance.lastPlayedAt)}
            </div>
            <div className="w-[76px] shrink-0 whitespace-nowrap text-right text-xs text-text-faint">
              {instance.totalPlaySeconds > 0 ? formatPlaytime(instance.totalPlaySeconds) : '—'}
            </div>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (running) actions.onStop(instance.id);
                else actions.onPlay(instance.id);
              }}
              className={cn(
                'h-[30px] shrink-0 rounded-pill px-3.5 text-[12.5px] font-semibold transition-[filter,transform] duration-fast active:scale-95',
                running
                  ? 'bg-danger/[0.18] text-danger hover:bg-danger/25'
                  : 'bg-[image:var(--accent-gradient)] text-white hover:brightness-110',
              )}
            >
              {running ? t`Остановить` : t`Играть`}
            </button>
          </>
        )}
      </div>
    </ContextMenu>
  );
}
