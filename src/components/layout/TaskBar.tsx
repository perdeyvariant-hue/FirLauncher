import { useMemo } from 'react';
import type { ReactElement } from 'react';
import { ChevronUp, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from '@/components/ui/IconButton';
import { Progress } from '@/components/ui/Progress';
import { formatBytes, formatSpeed } from '@/lib/format';
import type { Task } from '@/types/task';
import { activeTasks, overallProgress, useTasks } from '@/store/useTasks';
import { useLaunch } from '@/store/useLaunch';
import { useUI } from '@/store/useUI';
import { t } from '@/lib/i18n';

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
        label={t`Отменить`}
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
  const allTasks = useTasks((state) => state.tasks);
  // The launch card in the corner already shows its own preparation.
  const launching = useLaunch((state) => (state.visible ? state.instanceId : null));
  const tasks = useMemo(
    () => (launching === null ? allTasks : allTasks.filter((task) => task.instanceId !== launching)),
    [allTasks, launching],
  );
  const active = useMemo(() => activeTasks(tasks), [tasks]);
  const overall = useMemo(() => overallProgress(tasks), [tasks]);
  const expanded = useUI((state) => state.taskbarExpanded);
  const toggle = useUI((state) => state.toggleTaskbar);

  if (active.length === 0) return null;

  const headline =
    active.length === 1 ? (active[0]?.title ?? '') : t`Активных задач: ${String(active.length)}`;

  return (
    <div className="glass z-20 mb-3.5 ml-2 mr-4 shrink-0 animate-sheet-in overflow-hidden rounded-[22px]">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className="flex h-12 w-full items-center gap-3 px-[18px] text-left transition-colors duration-fast ease-out hover:bg-[var(--hover)]"
      >
        <Loader2 size={14} strokeWidth={1.5} className="shrink-0 animate-spin-slow text-accent" />
        <span className="shrink-0 truncate text-[13px] font-semibold text-text">{headline}</span>
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
        <div className="hairline-t max-h-56 animate-slide-up overflow-y-auto">
          {active.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}
