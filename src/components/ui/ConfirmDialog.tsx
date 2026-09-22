import type { ReactElement } from 'react';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { t } from '@/lib/i18n';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = t`Подтвердить`,
  cancelLabel = t`Отмена`,
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): ReactElement {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      width="sm"
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="h-1" />
    </Dialog>
  );
}
