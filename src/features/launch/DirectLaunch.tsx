import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Progress } from '@/components/ui/Progress';
import * as instancesApi from '@/api/instances';
import * as tasksApi from '@/api/tasks';
import * as windowApi from '@/api/window';
import { onEvent } from '@/lib/events';
import { toLauncherError } from '@/lib/ipc';
import { activeAccountOf, useAccounts } from '@/store/useAccounts';
import { useInstances } from '@/store/useInstances';
import { useTasks } from '@/store/useTasks';
import { t, translate } from '@/lib/i18n';

export interface DirectLaunchProps {
  /** The instance the shortcut asked for. */
  instanceId: string;
  /** Instances and accounts have been loaded; the launch can start. */
  ready: boolean;
  /** Give up on the small card and show the whole launcher. */
  onOpenLauncher: () => void;
}

type Phase = 'waiting' | 'preparing' | 'running' | 'failed';

/**
 * What a desktop shortcut shows: a small card that prepares the instance,
 * hides itself when the game window comes up and closes the launcher when
 * the game exits. The launcher only reappears if something went wrong.
 */
export function DirectLaunch({ instanceId, ready, onOpenLauncher }: DirectLaunchProps): ReactElement {
  const instances = useInstances((state) => state.instances);
  const accounts = useAccounts((state) => state.accounts);
  const tasks = useTasks((state) => state.tasks);

  const [phase, setPhase] = useState<Phase>('waiting');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const started = useRef(false);

  const instance = instances.find((item) => item.id === instanceId) ?? null;
  // The launch task carries the stage and the progress; it is the only one
  // that can be running for this instance right now.
  const task = tasks.find((item) => item.instanceId === instanceId && item.state === 'running') ?? null;

  // The window is hidden until this card exists, so show it as soon as it does.
  useEffect(() => {
    void windowApi.shrinkLauncher();
  }, []);

  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;

    if (instance === null) {
      setPhase('failed');
      setError(t`Сборка из ярлыка не найдена — возможно, её удалили`);
      return;
    }
    const account = activeAccountOf(useAccounts.getState());
    if (account === null) {
      setPhase('failed');
      setError(t`Сначала добавьте аккаунт в лаунчере`);
      return;
    }

    setPhase('preparing');
    setError(null);
    instancesApi.launchInstance(instanceId, account.id, null).catch((raw: unknown) => {
      setPhase('failed');
      setError(toLauncherError(raw).message);
    });
  }, [ready, attempt, instance, accounts, instanceId]);

  // A failed install shows up as a failed task, not as a rejected call.
  useEffect(() => {
    const failed = tasks.find(
      (item) => item.instanceId === instanceId && item.state === 'failed' && item.error !== null,
    );
    if (failed?.error !== undefined && failed.error !== null) {
      setPhase('failed');
      setError(failed.error);
    }
  }, [tasks, instanceId]);

  useEffect(() => {
    let disposed = false;
    const unsubscribers: (() => void)[] = [];
    const track = (promise: Promise<() => void>): void => {
      void promise.then((fn) => {
        if (disposed) fn();
        else unsubscribers.push(fn);
      });
    };

    track(
      onEvent('game://started', (payload) => {
        if (payload.instanceId !== instanceId) return;
        setPhase('running');
        void windowApi.hideLauncher();
      }),
    );

    track(
      onEvent('game://exit', (payload) => {
        if (payload.instanceId !== instanceId) return;
        // A crash has something to say, so the launcher comes back with the
        // crash assistant. A normal exit means the job is done.
        if (payload.crashed) {
          onOpenLauncher();
          void windowApi.restoreLauncher();
        } else {
          void windowApi.quitLauncher();
        }
      }),
    );

    return () => {
      disposed = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [instanceId, onOpenLauncher]);

  const cancel = (): void => {
    if (task !== null && task.cancellable) void tasksApi.cancelTask(task.id);
    void windowApi.quitLauncher();
  };

  const openLauncher = (): void => {
    onOpenLauncher();
    void windowApi.restoreLauncher();
  };

  return (
    <main className="flex h-screen flex-col justify-between overflow-hidden bg-bg p-5 text-text">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">{instance?.name ?? t`Запуск сборки`}</p>
        <p className="text-2xs text-text-dim">
          {instance === null
            ? 'FirLauncher'
            : `Minecraft ${instance.mcVersion}${instance.loader === 'vanilla' ? '' : ` · ${instance.loader}`}`}
        </p>
      </div>

      {phase === 'failed' ? (
        <p className="selectable max-h-24 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-danger">
          {error === null ? t`Не удалось запустить игру` : translate(error)}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Loader2 size={13} strokeWidth={1.5} className="animate-spin-slow text-accent" />
            <p className="text-xs text-text-dim">
              {phase === 'running'
                ? t`Игра запускается…`
                : task === null
                  ? t`Подготовка…`
                  : translate(task.stage)}
            </p>
          </div>
          <Progress value={task?.progress ?? null} size="xs" />
        </div>
      )}

      <div className="flex justify-end gap-2">
        {phase === 'failed' ? (
          <>
            <Button size="sm" variant="ghost" onClick={openLauncher}>
              {t`Открыть лаунчер`}</Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                started.current = false;
                setPhase('waiting');
                setError(null);
                setAttempt((value) => value + 1);
              }}
            >
              {t`Повторить`}</Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={cancel}>
            {t`Отмена`}</Button>
        )}
      </div>
    </main>
  );
}
