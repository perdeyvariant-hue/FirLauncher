import { useState } from 'react';
import type { ReactElement } from 'react';
import { Shield, UserCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { useAccounts } from '@/store/useAccounts';
import { t } from '@/lib/i18n';

export interface AddAccountDialogProps {
  open: boolean;
  onClose: () => void;
  /** Hands over to the device-code dialog. */
  onMicrosoft: () => void;
}

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;

export function AddAccountDialog({
  open,
  onClose,
  onMicrosoft,
}: AddAccountDialogProps): ReactElement {
  const addOffline = useAccounts((state) => state.addOffline);

  const [username, setUsername] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = username.trim();
  const valid = USERNAME_PATTERN.test(trimmed);
  const error = touched && !valid ? t`От 3 до 16 символов: латиница, цифры и «_»` : null;

  const submitOffline = async (): Promise<void> => {
    setSubmitting(true);
    await addOffline(trimmed);
    setSubmitting(false);
    setUsername('');
    setTouched(false);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t`Добавить аккаунт`}
      description={t`Microsoft — для игры на серверах и доступа к скинам. Оффлайн — только одиночная игра.`}
      busy={submitting}
    >
      <div className="flex flex-col gap-4 py-2">
        <section className="panel flex flex-col gap-3 p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-dim">
              <Shield size={17} strokeWidth={1.5} />
            </span>
            <div className="min-w-0">
              <h3 className="text-xs font-semibold text-text">Microsoft</h3>
              <p className="mt-1 text-2xs leading-relaxed text-text-dim">
                {t`Вход по коду устройства: лаунчер покажет код, вы подтвердите его в браузере. Токен сохранится в системном хранилище ключей.`}</p>
            </div>
          </div>
          <div>
            <Button
              variant="primary"
              size="sm"
              onClick={onMicrosoft}
            >
              {t`Войти через Microsoft`}</Button>
          </div>
        </section>

        <section className="panel flex flex-col gap-3 p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-dim">
              <UserCircle2 size={17} strokeWidth={1.5} />
            </span>
            <div className="min-w-0">
              <h3 className="text-xs font-semibold text-text">{t`Оффлайн-аккаунт`}</h3>
              <p className="mt-1 text-2xs leading-relaxed text-text-dim">
                {t`UUID вычисляется из ника детерминированно, как в официальном клиенте.`}</p>
            </div>
          </div>

          <Input
            label={t`Ник`}
            placeholder="Steve"
            value={username}
            error={error}
            onChange={(event) => {
              setUsername(event.target.value);
            }}
            onBlur={() => {
              setTouched(true);
            }}
          />

          <div>
            <Button
              size="sm"
              disabled={!valid || submitting}
              loading={submitting}
              onClick={() => {
                void submitOffline();
              }}
            >
              {t`Создать оффлайн-аккаунт`}</Button>
          </div>
        </section>
      </div>
    </Dialog>
  );
}
