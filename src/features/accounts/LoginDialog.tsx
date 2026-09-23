import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Check, Loader2, RotateCw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import * as accountsApi from '@/api/accounts';
import { onEvent } from '@/lib/events';
import { toLauncherError } from '@/lib/ipc';
import type { LoginState } from '@/types/account';
import { useAccounts } from '@/store/useAccounts';
import { t, translate } from '@/lib/i18n';

export interface LoginDialogProps {
  open: boolean;
  onClose: () => void;
}

type Step = Extract<LoginState, { phase: 'exchanging' }>['step'];

const STEPS: readonly { readonly id: Step; readonly label: string }[] = [
  { id: 'xbox', label: 'Xbox Live' },
  { id: 'xsts', label: t`Авторизация Xbox` },
  { id: 'minecraft', label: t`Сервисы Minecraft` },
  { id: 'profile', label: t`Профиль игрока` },
];

/** Closing on success is deferred just long enough to register the tick. */
const DONE_CLOSE_MS = 900;

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

/** Watches the sign-in that happens in Microsoft's own window. */
export function LoginDialog({ open, onClose }: LoginDialogProps): ReactElement {
  const load = useAccounts((store) => store.load);
  const setActive = useAccounts((store) => store.setActive);

  const [state, setState] = useState<LoginState>({ phase: 'waiting' });
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
    setState({ phase: 'waiting' });

    void onEvent('auth://login', (next) => {
      if (disposed) return;
      setState(next);
      if (next.phase !== 'waiting' && next.phase !== 'exchanging') finishedRef.current = true;
      // The person closed Microsoft's window: nothing to report, just leave.
      if (next.phase === 'cancelled') onCloseRef.current();
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
      // Closing mid-flow must also close Microsoft's window.
      if (!finishedRef.current) void accountsApi.cancelMicrosoftLogin();
    };
  }, [open, attempt, load, setActive]);

  const busy = state.phase === 'exchanging';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t`Вход через Microsoft`}
      description={t`Пароль вводится только на странице Microsoft — лаунчер его не видит.`}
      width="sm"
      busy={busy}
      footer={
        state.phase === 'done' ? undefined : (
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t`Отмена`}</Button>
        )
      }
    >
      <div className="flex min-h-[180px] flex-col justify-center py-3">
        {(state.phase === 'waiting' || state.phase === 'cancelled') && (
          <div className="flex flex-col items-center gap-3 text-center">
            <Loader2 size={20} strokeWidth={1.5} className="animate-spin-slow text-accent" />
            <p className="text-xs leading-relaxed text-text-dim">
              {t`Войдите в открывшемся окне Microsoft — лаунчер сам подхватит вход.`}</p>
            <p className="text-2xs text-text-dim">
              {t`Окно не видно? Оно могло открыться за лаунчером.`}</p>
          </div>
        )}

        {state.phase === 'exchanging' && <StepList current={state.step} />}

        {state.phase === 'done' && (
          <div className="flex animate-scale-in flex-col items-center gap-3 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 text-accent">
              <Check size={20} strokeWidth={2} />
            </span>
            <p className="text-sm text-text">{t`Аккаунт добавлен`}</p>
          </div>
        )}

        {state.phase === 'failed' && (
          <div className="flex flex-col gap-3">
            <p className="selectable whitespace-pre-wrap text-xs leading-relaxed text-danger">
              {translate(state.message)}
            </p>
            <div>
              <Button
                size="sm"
                icon={<RotateCw size={13} strokeWidth={1.5} />}
                onClick={() => {
                  setAttempt((value) => value + 1);
                }}
              >
                {t`Попробовать снова`}</Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
