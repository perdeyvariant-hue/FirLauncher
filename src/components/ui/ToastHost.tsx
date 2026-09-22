import { useState } from 'react';
import type { ReactElement } from 'react';
import { AlertCircle, Check, ChevronDown, Info, RotateCw, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useToasts } from '@/store/useToasts';
import type { Toast } from '@/store/useToasts';
import { IconButton } from './IconButton';
import { t } from '@/lib/i18n';

const ICONS = {
  info: <Info size={15} strokeWidth={1.5} />,
  success: <Check size={15} strokeWidth={1.5} />,
  error: <AlertCircle size={15} strokeWidth={1.5} />,
} as const;

function ToastRow({ toast }: { toast: Toast }): ReactElement {
  const dismiss = useToasts((state) => state.dismiss);
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      role="status"
      className={cn(
        'pointer-events-auto w-[360px] animate-slide-up overflow-hidden rounded-lg',
        'border bg-surface shadow-[var(--shadow-panel)]',
        toast.tone === 'error' ? 'border-danger/35' : 'border-border',
      )}
    >
      <div className="flex items-start gap-2.5 p-3">
        <span
          className={cn(
            'mt-px shrink-0',
            toast.tone === 'error'
              ? 'text-danger'
              : toast.tone === 'success'
                ? 'text-accent'
                : 'text-text-dim',
          )}
        >
          {ICONS[toast.tone]}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-xs leading-relaxed text-text">{toast.title}</p>

          {toast.detail !== null && (
            <>
              <button
                type="button"
                onClick={() => {
                  setExpanded((value) => !value);
                }}
                className="mt-1 inline-flex items-center gap-1 text-2xs text-text-dim hover:text-text"
              >
                <ChevronDown
                  size={12}
                  strokeWidth={1.5}
                  className={cn('transition-transform duration-fast', expanded && 'rotate-180')}
                />
                {t`Подробности`}</button>
              {expanded && (
                <pre className="selectable mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 font-mono text-2xs leading-relaxed text-text-dim">
                  {toast.detail}
                </pre>
              )}
            </>
          )}

          {toast.onRetry !== null && (
            <button
              type="button"
              onClick={() => {
                toast.onRetry?.();
                dismiss(toast.id);
              }}
              className="mt-2 inline-flex items-center gap-1.5 text-2xs font-medium text-accent hover:text-accent-hover"
            >
              <RotateCw size={12} strokeWidth={1.5} />
              {t`Повторить`}</button>
          )}
        </div>

        <IconButton
          label={t`Закрыть уведомление`}
          size="sm"
          icon={<X size={14} strokeWidth={1.5} />}
          onClick={() => {
            dismiss(toast.id);
          }}
        />
      </div>
    </div>
  );
}

export function ToastHost(): ReactElement {
  const toasts = useToasts((state) => state.toasts);

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[60] flex flex-col items-end gap-2">
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
