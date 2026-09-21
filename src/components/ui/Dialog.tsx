import { useCallback, useEffect, useRef } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from './IconButton';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Rendered right-aligned in the footer. */
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
  /** Blocks closing while a long operation is in flight. */
  busy?: boolean;
}

const WIDTHS: Readonly<Record<NonNullable<DialogProps['width']>, string>> = {
  sm: 'max-w-[380px]',
  md: 'max-w-[520px]',
  lg: 'max-w-[760px]',
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
      <div className="absolute inset-0 animate-fade-in bg-[var(--overlay)] backdrop-blur-[2px]" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'relative flex w-full animate-scale-in flex-col overflow-hidden outline-none',
          'rounded-xl border border-border bg-surface shadow-[var(--shadow-panel)]',
          'max-h-[calc(100vh-48px)]',
          WIDTHS[width],
        )}
      >
        <header className="flex items-start gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-text">{title}</h2>
            {description !== undefined && (
              <p className="mt-1 text-xs leading-relaxed text-text-dim">{description}</p>
            )}
          </div>
          <IconButton
            label="Закрыть"
            size="sm"
            disabled={busy}
            icon={<X size={15} strokeWidth={1.5} />}
            onClick={requestClose}
          />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">{children}</div>

        {footer !== undefined && (
          <footer className="hairline-t flex items-center justify-end gap-2 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
