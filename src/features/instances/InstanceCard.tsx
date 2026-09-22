import type { ReactElement } from 'react';
import { Copy, FolderOpen, Play, Share2, Square, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/Badge';
import { ContextMenu } from '@/components/ui/ContextMenu';
import type { ContextMenuItem } from '@/components/ui/ContextMenu';
import { formatPlaytime, formatRelativeDate, initialsOf } from '@/lib/format';
import type { Instance } from '@/types/instance';
import { LOADER_LABELS } from '@/types/instance';

export interface InstanceCardActions {
  onOpen: (id: string) => void;
  onPlay: (id: string) => void;
  onStop: (id: string) => void;
  onOpenFolder: (id: string) => void;
  onDuplicate: (id: string) => void;
  onExport: (id: string) => void;
  onDelete: (id: string) => void;
}

export interface InstanceCardProps extends InstanceCardActions {
  instance: Instance;
}

export function InstanceCard({ instance, ...actions }: InstanceCardProps): ReactElement {
  const running = instance.status.state === 'running';
  const installing = instance.status.state === 'installing';

  const menu: readonly ContextMenuItem[] = [
    {
      id: 'play',
      label: running ? 'Остановить' : 'Играть',
      icon: running ? (
        <Square size={14} strokeWidth={1.5} />
      ) : (
        <Play size={14} strokeWidth={1.5} />
      ),
      onSelect: () => {
        if (running) actions.onStop(instance.id);
        else actions.onPlay(instance.id);
      },
    },
    {
      id: 'folder',
      label: 'Папка',
      icon: <FolderOpen size={14} strokeWidth={1.5} />,
      onSelect: () => {
        actions.onOpenFolder(instance.id);
      },
    },
    {
      id: 'duplicate',
      label: 'Дублировать',
      icon: <Copy size={14} strokeWidth={1.5} />,
      onSelect: () => {
        actions.onDuplicate(instance.id);
      },
    },
    {
      id: 'export',
      label: 'Экспорт',
      icon: <Share2 size={14} strokeWidth={1.5} />,
      onSelect: () => {
        actions.onExport(instance.id);
      },
    },
    {
      id: 'delete',
      label: 'Удалить',
      icon: <Trash2 size={14} strokeWidth={1.5} />,
      tone: 'danger',
      separatorBefore: true,
      onSelect: () => {
        actions.onDelete(instance.id);
      },
    },
  ];

  return (
    <ContextMenu items={menu}>
      <article
        tabIndex={0}
        role="button"
        onClick={() => {
          actions.onOpen(instance.id);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            actions.onOpen(instance.id);
          }
        }}
        className={cn(
          'group relative flex cursor-pointer flex-col gap-3 rounded-lg border p-3',
          'bg-surface transition-[border-color,transform] duration-fast ease-out',
          'hover:border-text-dim/35 active:scale-[0.995]',
          running ? 'border-accent/45' : 'border-border',
        )}
      >
        <div className="flex items-start gap-3">
          <InstanceIcon instance={instance} />

          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-medium text-text">{instance.name}</h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <Badge tone="outline">{instance.mcVersion}</Badge>
              {instance.loader !== 'vanilla' && (
                <Badge tone="neutral">
                  {LOADER_LABELS[instance.loader]}
                  {instance.loaderVersion !== null && ` ${instance.loaderVersion}`}
                </Badge>
              )}
            </div>
          </div>

          <button
            type="button"
            aria-label={running ? 'Остановить' : 'Играть'}
            onClick={(event) => {
              event.stopPropagation();
              if (running) actions.onStop(instance.id);
              else actions.onPlay(instance.id);
            }}
            disabled={installing}
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
              'transition-[opacity,background-color] duration-fast ease-out',
              'disabled:pointer-events-none disabled:opacity-40',
              running
                ? 'bg-danger/15 text-danger hover:bg-danger/25'
                : 'bg-accent text-on-accent opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-accent-hover',
            )}
          >
            {running ? (
              <Square size={14} strokeWidth={1.5} fill="currentColor" />
            ) : (
              <Play size={14} strokeWidth={1.5} fill="currentColor" />
            )}
          </button>
        </div>

        <footer className="flex items-center justify-between text-2xs text-text-dim">
          <span>
            {instance.totalPlaySeconds > 0
              ? formatPlaytime(instance.totalPlaySeconds)
              : 'ещё не запускалась'}
          </span>
          <span>{formatRelativeDate(instance.lastPlayedAt)}</span>
        </footer>
      </article>
    </ContextMenu>
  );
}

function InstanceIcon({ instance }: { instance: Instance }): ReactElement {
  if (instance.iconPath !== null) {
    return (
      <img
        src={instance.iconPath}
        alt=""
        width={40}
        height={40}
        className="h-10 w-10 shrink-0 rounded-md object-cover"
        style={{ imageRendering: 'pixelated' }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-2 text-xs font-semibold text-text-dim"
    >
      {initialsOf(instance.name)}
    </span>
  );
}
