import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Check, Copy, ExternalLink, Loader2, RotateCw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Progress } from '@/components/ui/Progress';
import * as accountsApi from '@/api/accounts';
import { openExternal } from '@/api/system';
import { onEvent } from '@/lib/events';
import { toLauncherError } from '@/lib/ipc';
import type { DeviceCodeState } from '@/types/account';
import { useAccounts } from '@/store/useAccounts';

export interface DeviceCodeDialogProps {
  open: boolean;
  onClose: () => void;
}

type Step = Extract<DeviceCodeState, { phase: 'exchanging' }>['step'];

const STEPS: readonly { readonly id: Step; readonly label: string }[] = [
  { id: 'xbox', label: 'Xbox Live' },
  { id: 'xsts', label: 'Авторизация Xbox' },
  { id: 'minecraft', label: 'Сервисы Minecraft' },
  { id: 'profile', label: 'Профиль игрока' },
];

/** Closing on success is deferred just long enough to register the tick. */
const DONE_CLOSE_MS = 900;

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes)}:${String(rest).padStart(2, '0')}`;
}

function StepList({ current }: { current: Step }): ReactElement {
  const currentIndex = STEPS.findIndex((step) => step.id === current);
  return (
    <ol className="flex flex-col gap-2">
      {STEPS.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <li key={step.id} className="flex items-center gap-2.5 text-xs">
            <span
              className={cn(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                done && 'bg-accent/15 text-accent',
                active && 'text-accent',
                !done && !active && 'bg-surface-2 text-text-dim',
              )}
            >
              {done ? (
                <Check size={12} strokeWidth={2} />
              ) : active ? (
                <Loader2 size={13} strokeWidth={1.5} className="animate-spin-slow" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
              )}
            </span>
            <span className={cn(active ? 'text-text' : 'text-text-dim')}>{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function DeviceCodeDialog({ open, onClose }: DeviceCodeDialogProps): ReactElement {
  const load = useAccounts((store) => store.load);
  const setActive = useAccounts((store) => store.setActive);

  const [state, setState] = useState<DeviceCodeState>({ phase: 'requesting' });
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [totalSeconds, setTotalSeconds] = useState(1);
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // The parent re-creates onClose on every render; the flow must not restart
  // because of that, so the latest callback is read through a ref.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const finishedRef = useRef(false);

  useEffect(() => {
    if (!open) return;

    let disposed = false;
    let unlisten: (() => void) | null = null;
    let closeTimer: number | null = null;
    finishedRef.current = false;
    setState({ phase: 'requesting' });
    setCopied(false);

    void onEvent('auth://device-code', (next) => {
      if (disposed) return;
      setState(next);
      if (next.phase === 'waiting') {
        setSecondsLeft(next.expiresInSeconds);
        setTotalSeconds(Math.max(1, next.expiresInSeconds));
      }
      if (next.phase === 'done' || next.phase === 'failed') finishedRef.current = true;
      if (next.phase === 'done') {
        void load().then(() => {
          setActive(next.accountId);
        });
        closeTimer = window.setTimeout(() => {
          onCloseRef.current();
        }, DONE_CLOSE_MS);
      }
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
      // Start only once we are listening, so the first event cannot be lost.
      accountsApi.beginMicrosoftLogin().catch((raw: unknown) => {
        if (disposed) return;
        finishedRef.current = true;
        setState({ phase: 'failed', message: toLauncherError(raw).message });
      });
    });

    return () => {
      disposed = true;
      unlisten?.();
      if (closeTimer !== null) window.clearTimeout(closeTimer);
      // Closing mid-flow must stop the backend from polling Microsoft.
      if (!finishedRef.current) void accountsApi.cancelMicrosoftLogin();
    };
  }, [open, attempt, load, setActive]);

  useEffect(() => {
    if (state.phase !== 'waiting') return;
    const timer = window.setInterval(() => {
      setSecondsLeft((value) => Math.max(0, value - 1));
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [state.phase]);

  const copyCode = async (code: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const busy = state.phase === 'exchanging';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Вход через Microsoft"
      description="Пароль вводится только на сайте Microsoft — лаунчер его не видит."
      width="sm"
      busy={busy}
      footer={
        state.phase === 'done' ? undefined : (
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
        )
      }
    >
      <div className="flex min-h-[180px] flex-col justify-center py-3">
        {state.phase === 'requesting' && (
          <div className="flex flex-col items-center gap-3 text-center">
            <Loader2 size={20} strokeWidth={1.5} className="animate-spin-slow text-accent" />
            <p className="text-xs text-text-dim">Получаем код у Microsoft…</p>
          </div>
        )}

        {state.phase === 'waiting' && (
          <div className="flex flex-col gap-4">
            <p className="text-xs leading-relaxed text-text-dim">
              Откройте страницу входа и введите этот код. Лаунчер сам заметит подтверждение.
            </p>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-4 py-3">
              <span className="selectable font-mono text-xl tracking-[0.2em] text-text">
                {state.userCode}
              </span>
              <Button
                size="sm"
                variant="ghost"
                icon={
                  copied ? (
                    <Check size={13} strokeWidth={1.5} className="text-accent" />
                  ) : (
                    <Copy size={13} strokeWidth={1.5} />
                  )
                }
                onClick={() => {
                  void copyCode(state.userCode);
                }}
              >
                {copied ? 'Скопирован' : 'Копировать'}
              </Button>
            </div>

            <Button
              variant="primary"
              fullWidth
              icon={<ExternalLink size={14} strokeWidth={1.5} />}
              onClick={() => {
                // Copy first: the page asks for the code immediately.
                void copyCode(state.userCode).then(() => openExternal(state.verificationUri));
              }}
            >
              Скопировать код и открыть страницу
            </Button>

            <div className="flex flex-col gap-1.5">
              <Progress value={secondsLeft / totalSeconds} size="xs" />
              <p className="text-2xs text-text-dim">
                Код действует ещё {formatCountdown(secondsLeft)}
              </p>
            </div>
          </div>
        )}

        {state.phase === 'exchanging' && <StepList current={state.step} />}

        {state.phase === 'done' && (
          <div className="flex animate-scale-in flex-col items-center gap-3 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 text-accent">
              <Check size={20} strokeWidth={2} />
            </span>
            <p className="text-sm text-text">Аккаунт добавлен</p>
          </div>
        )}

        {state.phase === 'failed' && (
          <div className="flex flex-col gap-3">
            <p className="selectable whitespace-pre-wrap text-xs leading-relaxed text-danger">
              {state.message}
            </p>
            <div>
              <Button
                size="sm"
                icon={<RotateCw size={13} strokeWidth={1.5} />}
                onClick={() => {
                  setAttempt((value) => value + 1);
                }}
              >
                Попробовать снова
              </Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
