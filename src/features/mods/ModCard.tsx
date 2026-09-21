import { useState } from 'react';
import type { ReactElement } from 'react';
import { Check, Download, ExternalLink, Package } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { formatCompactNumber, formatRelativeDate } from '@/lib/format';
import type { ModProject } from '@/types/mod';

export type InstallState = 'idle' | 'working' | 'installed';

export interface ModCardProps {
  project: ModProject;
  state: InstallState;
  onInstall: () => void;
  onOpenPage: (() => void) | null;
}

function ProjectIcon({ project }: { project: ModProject }): ReactElement {
  const [broken, setBroken] = useState(false);
  if (project.iconUrl === null || broken) {
    return (
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-text-dim">
        <Package size={18} strokeWidth={1.5} />
      </span>
    );
  }
  return (
    <img
      src={project.iconUrl}
      alt=""
      width={48}
      height={48}
      loading="lazy"
      onError={() => {
        setBroken(true);
      }}
      className="h-12 w-12 shrink-0 rounded-lg bg-surface-2 object-cover"
    />
  );
}

export function ModCard({ project, state, onInstall, onOpenPage }: ModCardProps): ReactElement {
  return (
    <article className="panel flex gap-3 p-3 transition-[border-color] duration-fast ease-out hover:border-text-dim/35">
      <ProjectIcon project={project} />

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <h3 className="truncate text-sm font-medium text-text">{project.name}</h3>
          {project.author !== '' && (
            <span className="shrink-0 truncate text-2xs text-text-dim">{project.author}</span>
          )}
        </div>

        <p className="line-clamp-2 text-xs leading-relaxed text-text-dim">{project.summary}</p>

        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          <span className="inline-flex items-center gap-1 text-2xs text-text-dim">
            <Download size={11} strokeWidth={1.5} />
            {formatCompactNumber(project.downloads)}
          </span>
          {project.updatedAt !== null && (
            <span className="text-2xs text-text-dim">· {formatRelativeDate(project.updatedAt)}</span>
          )}
          {project.categories.slice(0, 3).map((category) => (
            <Badge key={category} tone="outline">
              {category}
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end justify-between gap-2">
        {state === 'installed' ? (
          <Button size="sm" disabled icon={<Check size={13} strokeWidth={1.5} />}>
            Установлен
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            loading={state === 'working'}
            onClick={onInstall}
          >
            Установить
          </Button>
        )}
        {onOpenPage !== null && (
          <IconButton
            label="Открыть страницу мода"
            size="sm"
            icon={<ExternalLink size={13} strokeWidth={1.5} />}
            onClick={onOpenPage}
          />
        )}
      </div>
    </article>
  );
}
