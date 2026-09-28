import { useCallback, useEffect, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from './IconButton';
import { t } from '@/lib/i18n';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Rendered right-aligned in the footer. */
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg' | 'xl';
  /** Blocks closing while a long operation is in flight. */
  busy?: boolean;
}

const WIDTHS: Readonly<Record<NonNullable<DialogProps['width']>, string>> = {
  sm: 'max-w-[440px]',
  md: 'max-w-[500px]',
  lg: 'max-w-[760px]',
  xl: 'max-w-[980px]',
};

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'md',
  busy = false,
}: DialogProps): ReactElement | null {
  const panelRef = useRef<HTMLDivElement>(null);

  const requestClose = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    // Focus the first field if there is one; otherwise the panel itself, so
    // screen readers announce the dialog without painting a focus ring on
    // the close button before the user has done anything.
    const panel = panelRef.current;
    const firstField = panel?.querySelector<HTMLElement>('input, select, textarea');
    if (firstField !== null && firstField !== undefined) firstField.focus();
    else panel?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, requestClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div className="absolute inset-0 animate-fade-in bg-[var(--overlay)] backdrop-blur-[6px]" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'glass-sheet relative flex w-full animate-sheet-in flex-col outline-none',
          'overflow-hidden rounded-2xl',
          'shadow-[inset_0_0_0_1px_var(--glass-border),0_30px_80px_rgb(0_0_0/0.5),inset_0_1px_0_rgb(255_255_255/0.15)]',
          'max-h-[calc(100vh-48px)]',
          WIDTHS[width],
        )}
      >
        <header className="flex items-start gap-3 px-6 pb-2 pt-6">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-bold tracking-[-0.02em] text-text">{title}</h2>
            {description !== undefined && (
              <p className="mt-1.5 text-[13px] leading-relaxed text-text-dim">{description}</p>
            )}
          </div>
          <IconButton
            label={t`Закрыть`}
            size="sm"
            disabled={busy}
            icon={<X size={15} strokeWidth={1.5} />}
            onClick={requestClose}
          />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">{children}</div>

        {footer !== undefined && (
          <footer className="flex items-center justify-end gap-2 px-6 pb-6 pt-3">{footer}</footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
