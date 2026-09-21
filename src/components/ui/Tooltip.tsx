import { useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

export interface TooltipProps {
  content: string;
  children: ReactNode;
  side?: 'top' | 'right';
  className?: string;
}

const OFFSET = 8;
const DELAY_MS = 260;

export function Tooltip({ content, children, side = 'top', className }: TooltipProps): ReactElement {
  const [box, setBox] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);

  const show = (): void => {
    timer.current = window.setTimeout(() => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect === undefined) return;
      setBox(
        side === 'right'
          ? { x: rect.right + OFFSET, y: rect.top + rect.height / 2 }
          : { x: rect.left + rect.width / 2, y: rect.top - OFFSET },
      );
    }, DELAY_MS);
  };

  const hide = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setBox(null);
  };

  return (
    <>
      <span
        ref={anchorRef}
        // Not `display: contents` — the anchor must have a real box for
        // getBoundingClientRect() to return usable coordinates.
        className={cn('inline-flex', className)}
        onMouseEnter={show}
        onMouseLeave={hide}
        onMouseDown={hide}
      >
        {children}
      </span>

      {box !== null &&
        createPortal(
          <div
            role="tooltip"
            style={{
              left: box.x,
              top: box.y,
              transform: side === 'right' ? 'translateY(-50%)' : 'translate(-50%, -100%)',
            }}
            className={cn(
              'pointer-events-none fixed z-[70] animate-fade-in whitespace-nowrap',
              'rounded-md border border-border bg-surface-2 px-2 py-1 text-2xs text-text',
              'shadow-[var(--shadow-panel)]',
            )}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
