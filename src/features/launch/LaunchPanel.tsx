import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { X } from 'lucide-react';
import * as instancesApi from '@/api/instances';
import { onEvent } from '@/lib/events';
import { translate, t } from '@/lib/i18n';
import { useInstances } from '@/store/useInstances';
import { useLaunch } from '@/store/useLaunch';
import type { LaunchLevel } from '@/store/useLaunch';
import { useTasks } from '@/store/useTasks';
import { useToasts } from '@/store/useToasts';
import { useUI } from '@/store/useUI';
import { Cover, loaderLabel, useInstanceTask } from '@/features/instances/InstanceCard';

const LEVEL_COLOR: Readonly<Record<LaunchLevel, string>> = {
  INFO: 'rgb(var(--accent-rgb))',
  DEBUG: 'rgb(236 232 250 / 0.45)',
  WARN: '#fbbf24',
  ERROR: '#f87171',
};

const MESSAGE_COLOR: Readonly<Record<LaunchLevel, string>> = {
  INFO: 'rgb(236 232 250 / 0.82)',
  DEBUG: 'rgb(236 232 250 / 0.55)',
  WARN: '#fde68a',
  ERROR: '#fca5a5',
};

/**
 * The card that follows a launch from the corner: preparation progress,
 * then the game's own log as it comes up. It goes away when the game exits;
 * hiding it leaves the game running.
 */
export function LaunchPanel(): ReactElement | null {
  const instanceId = useLaunch((state) => state.instanceId);
  const visible = useLaunch((state) => state.visible);
  const phase = useLaunch((state) => state.phase);
  const lines = useLaunch((state) => state.lines);
  const instance = useInstances(
    (state) => state.instances.find((item) => item.id === instanceId) ?? null,
  );
  const task = useInstanceTask(instanceId ?? '');
  // Other work in the bottom bar: sit above it rather than on it.
  const barShown = useTasks((state) =>
    state.tasks.some(
      (item) =>
        item.instanceId !== instanceId && (item.state === 'running' || item.state === 'queued'),
    ),
  );
  const cancelTask = useTasks((state) => state.cancel);
  const openInstance = useUI((state) => state.openInstance);
  const fail = useToasts((state) => state.fail);
  const logRef = useRef<HTMLDivElement>(null);

  // Follow the game's events for whichever instance the card is showing.
  useEffect(() => {
    const unsubscribers: (() => void)[] = [];
    let disposed = false;
    const track = (promise: Promise<() => void>): void => {
      void promise.then((unsubscribe) => {
        if (disposed) unsubscribe();
        else unsubscribers.push(unsubscribe);
      });
    };
    const mine = (id: string): boolean => useLaunch.getState().instanceId === id;

    track(
      onEvent('game://log', (payload) => {
        if (mine(payload.instanceId)) useLaunch.getState().push(payload.stream, payload.line);
      }),
    );
    track(
      onEvent('game://started', (payload) => {
        if (mine(payload.instanceId)) useLaunch.getState().started();
      }),
    );
    track(
      onEvent('game://exit', (payload) => {
        // A crash has its own assistant; either way this card is done.
        if (mine(payload.instanceId)) useLaunch.getState().close();
      }),
    );
    track(
      onEvent('task://finished', (finished) => {
        const state = useLaunch.getState();
        // Preparation failed or was cancelled before the game came up.
        if (
          finished.instanceId !== null &&
          mine(finished.instanceId) &&
          state.phase === 'preparing' &&
          finished.state !== 'succeeded'
        ) {
          state.close();
        }
      }),
    );
    return () => {
      disposed = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, []);

  // Keep the newest line in view.
  useEffect(() => {
    const log = logRef.current;
    if (log !== null) log.scrollTop = log.scrollHeight;
  }, [lines]);

  if (instanceId === null || !visible || instance === null) return null;

  const running = phase === 'running' || instance.status.state === 'running';
  const percent = running ? 100 : Math.round((task?.progress ?? 0) * 100);
  const status = running
    ? t`В игре`
    : task === null
      ? t`Запуск…`
      : `${translate(task.stage) || t`Подготовка`} ${String(percent)}%`;

  const stop = (): void => {
    if (running) {
      void instancesApi.killInstance(instance.id).catch((raw: unknown) => fail(raw));
    } else if (task?.cancellable === true) {
      void cancelTask(task.id);
    }
  };

  return (
    <div
      role="status"
      aria-label={t`Запуск ${instance.name}`}
      style={{ bottom: barShown ? 78 : 18 }}
      className="glass-sheet fixed right-[18px] z-[35] w-[560px] origin-bottom-right animate-sheet-in overflow-hidden rounded-[26px] shadow-[inset_0_0_0_1px_var(--glass-border),0_30px_80px_rgb(0_0_0/0.5),inset_0_1px_0_rgb(255_255_255/0.15)]"
    >
      <div className="flex items-center gap-3 px-4 pb-3.5 pt-4">
        <Cover instance={instance} size="row" className="h-[42px] w-[42px] shrink-0 rounded-[12px]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-semibold text-text">{instance.name}</p>
          <p className="mt-0.5 truncate text-xs text-text-dim">
            {instance.mcVersion} · {loaderLabel(instance)} · {status}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            openInstance(instance.id, 'logs');
          }}
          className="h-[30px] shrink-0 rounded-pill px-3 text-xs text-text shadow-rim transition-colors duration-fast hover:bg-[var(--hover)]"
        >
          {t`Весь лог`}
        </button>
        {(running || task?.cancellable === true) && (
          <button
            type="button"
            onClick={stop}
            className="h-[30px] shrink-0 rounded-pill bg-danger/[0.18] px-3 text-xs font-semibold text-danger transition-colors duration-fast hover:bg-danger/25"
          >
            {running ? t`Остановить` : t`Отменить`}
          </button>
        )}
        <button
          type="button"
          aria-label={t`Скрыть`}
          title={t`Скрыть — игра продолжит работать`}
          onClick={() => {
            useLaunch.getState().hide();
          }}
          className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-[var(--chip)] text-text-dim transition-colors duration-fast hover:text-text"
        >
          <X size={12} strokeWidth={2.6} />
        </button>
      </div>

      <div className="h-[3px] bg-[var(--track)]">
        <div
          className="h-full bg-[image:var(--accent-gradient)] transition-[width] duration-200 ease-linear"
          style={{ width: `${String(percent)}%` }}
        />
      </div>

      <div
        ref={logRef}
        className="selectable h-[230px] overflow-auto bg-[rgb(6_4_12/0.72)] px-4 py-3 font-mono text-[11.5px] leading-[1.65]"
      >
        {lines.length === 0 ? (
          <p className="text-[rgb(236_232_250/0.45)]">
            {running ? t`Игра запущена.` : t`Готовим файлы игры…`}
          </p>
        ) : (
          lines.map((line) => (
            <div key={line.seq} className="flex gap-2.5 whitespace-nowrap">
              <span className="shrink-0 text-[rgb(236_232_250/0.4)]">{line.time}</span>
              <span className="w-9 shrink-0" style={{ color: LEVEL_COLOR[line.level] }}>
                {line.level}
              </span>
              <span className="w-24 shrink-0 truncate text-[rgb(236_232_250/0.45)]">{line.thread}</span>
              <span className="truncate" style={{ color: MESSAGE_COLOR[line.level] }}>
                {line.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
