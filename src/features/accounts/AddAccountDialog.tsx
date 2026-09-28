import { useEffect, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { useAccounts } from '@/store/useAccounts';
import { t } from '@/lib/i18n';

export interface AddAccountDialogProps {
  open: boolean;
  onClose: () => void;
  /** Hands over to the sign-in dialog. */
  onMicrosoft: () => void;
}

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;

function MicrosoftMark(): ReactElement {
  return (
    <span aria-hidden className="grid shrink-0 grid-cols-[12px_12px] gap-0.5">
      <span className="h-3 bg-[#f25022]" />
      <span className="h-3 bg-[#7fba00]" />
      <span className="h-3 bg-[#00a4ef]" />
      <span className="h-3 bg-[#ffb900]" />
    </span>
  );
}

function Choice({
  icon,
  title,
  text,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3.5 rounded-[18px] bg-[var(--chip)] p-3.5 text-left shadow-rim transition-[background-color,transform] duration-fast hover:bg-[var(--hover)] active:scale-[0.98]"
    >
      {icon}
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-text">{title}</span>
        <span className="mt-0.5 block text-xs text-text-dim">{text}</span>
      </span>
    </button>
  );
}

/** Microsoft or offline; the offline nick is asked for on a second step. */
export function AddAccountDialog({
  open,
  onClose,
  onMicrosoft,
}: AddAccountDialogProps): ReactElement {
  const addOffline = useAccounts((state) => state.addOffline);

  const [step, setStep] = useState<'choose' | 'offline'>('choose');
  const [username, setUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep('choose');
    setUsername('');
  }, [open]);

  const valid = USERNAME_PATTERN.test(username);

  const submitOffline = async (): Promise<void> => {
    if (!valid) return;
    setSubmitting(true);
    await addOffline(username);
    setSubmitting(false);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t`Добавить аккаунт`}
      width="sm"
      busy={submitting}
      footer={
        step === 'offline' ? (
          <div className="flex w-full justify-between gap-2">
            <Button
              onClick={() => {
                setStep('choose');
              }}
            >
              {t`Назад`}
            </Button>
            <Button
              variant="primary"
              disabled={!valid}
              loading={submitting}
              onClick={() => {
                void submitOffline();
              }}
            >
              {t`Добавить`}
            </Button>
          </div>
        ) : undefined
      }
    >
      {step === 'choose' ? (
        <div className="flex flex-col gap-2.5 pb-3 pt-2">
          <Choice
            icon={<MicrosoftMark />}
            title="Microsoft"
            text={t`Лицензия, скины и игра на любых серверах`}
            onClick={onMicrosoft}
          />
          <Choice
            icon={
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinecap="round"
                className="shrink-0 text-text"
                aria-hidden
              >
                <circle cx="12" cy="8.5" r="3.8" />
                <path d="M4.5 20c1.2-3.8 4.2-5.5 7.5-5.5s6.3 1.7 7.5 5.5" />
              </svg>
            }
            title={t`Оффлайн`}
            text={t`Только ник — одиночная игра и серверы без проверки лицензии`}
            onClick={() => {
              setStep('offline');
            }}
          />
        </div>
      ) : (
        <form
          className="pt-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submitOffline();
          }}
        >
          <label htmlFor="offline-nick" className="mb-2 block text-[13px] text-text-dim">
            {t`Ник · 3–16 символов, латиница, цифры и _`}
          </label>
          <input
            id="offline-nick"
            autoFocus
            value={username}
            placeholder="Steve"
            spellCheck={false}
            onChange={(event) => {
              setUsername(event.target.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 16));
            }}
            className="field h-10 w-full rounded-[12px] px-3 font-mono text-sm font-medium text-text outline-none placeholder:text-text-faint focus:shadow-[inset_0_0_0_1px_var(--glass-border),0_0_0_3px_rgb(var(--accent-rgb)/0.35)]"
          />
          <p className="mt-2 text-xs text-text-faint">
            {t`UUID вычисляется из ника, как в официальном клиенте.`}
          </p>
        </form>
      )}
    </Dialog>
  );
}
