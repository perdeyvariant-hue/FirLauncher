import { useMemo } from 'react';
import type { ReactElement } from 'react';
import { ChevronUp, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from '@/components/ui/IconButton';
import { Progress } from '@/components/ui/Progress';
import { formatBytes, formatSpeed } from '@/lib/format';
import type { Task } from '@/types/task';
import { activeTasks, overallProgress, useTasks } from '@/store/useTasks';
import { useUI } from '@/store/useUI';

function TaskRow({ task }: { task: Task }): ReactElement {
  const cancel = useTasks((state) => state.cancel);

  const sizeLabel =
    task.bytesTotal === null
      ? formatBytes(task.bytesDone)
      : `${formatBytes(task.bytesDone)} / ${formatBytes(task.bytesTotal)}`;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-xs font-medium text-text">{task.title}</p>
          <p className="shrink-0 font-mono text-2xs tabular-nums text-text-dim">
            {sizeLabel} · {formatSpeed(task.bytesPerSecond)}
          </p>
        </div>
        <div className="mt-1.5 flex items-center gap-3">
          <Progress value={task.progress} size="xs" className="flex-1" />
          <span className="w-28 shrink-0 truncate text-right text-2xs text-text-dim">
            {task.stage}
          </span>
        </div>
      </div>

      <IconButton
        label="Отменить"
        size="sm"
        disabled={!task.cancellable}
        icon={<X size={14} strokeWidth={1.5} />}
        onClick={() => {
          void cancel(task.id);
        }}
      />
    </div>
  );
}

/** Global bottom panel: everything currently downloading or installing. */
export function TaskBar(): ReactElement | null {
  const tasks = useTasks((state) => state.tasks);
  const active = useMemo(() => activeTasks(tasks), [tasks]);
  const overall = useMemo(() => overallProgress(tasks), [tasks]);
  const expanded = useUI((state) => state.taskbarExpanded);
  const toggle = useUI((state) => state.toggleTaskbar);

  if (active.length === 0) return null;

  const headline =
    active.length === 1 ? (active[0]?.title ?? '') : `Активных задач: ${String(active.length)}`;

  return (
    <div className="shrink-0 border-t border-border bg-surface">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex h-11 w-full items-center gap-3 px-4 text-left transition-colors duration-fast ease-out hover:bg-surface-2"
      >
        <Loader2 size={14} strokeWidth={1.5} className="shrink-0 animate-spin-slow text-accent" />
        <span className="shrink-0 truncate text-xs text-text">{headline}</span>
        <Progress value={overall} size="xs" className="mx-1 max-w-[280px] flex-1" />
        <span className="ml-auto shrink-0 font-mono text-2xs tabular-nums text-text-dim">
          {overall === null ? '—' : `${String(Math.round(overall * 100))}%`}
        </span>
        <ChevronUp
          size={15}
          strokeWidth={1.5}
          className={cn(
            'shrink-0 text-text-dim transition-transform duration-fast ease-out',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {expanded && (
        <div className="max-h-56 animate-slide-up overflow-y-auto border-t border-border">
          {active.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}
