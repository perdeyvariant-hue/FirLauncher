import type { ReactElement } from 'react';
import { cn } from '@/lib/cn';

export interface ProgressProps {
  /** 0..1, or null for an indeterminate bar. */
  value: number | null;
  className?: string;
  tone?: 'accent' | 'danger';
  size?: 'xs' | 'sm';
}

export function Progress({
  value,
  className,
  tone = 'accent',
  size = 'sm',
}: ProgressProps): ReactElement {
  const clamped = value === null ? null : Math.min(Math.max(value, 0), 1);
  const barColor = tone === 'danger' ? 'bg-danger' : 'bg-accent';

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped === null ? undefined : Math.round(clamped * 100)}
      className={cn(
        'relative w-full overflow-hidden rounded-full bg-surface-2',
        size === 'xs' ? 'h-1' : 'h-1.5',
        className,
      )}
    >
      {clamped === null ? (
        <div className={cn('absolute inset-y-0 w-1/3 animate-indeterminate rounded-full', barColor)} />
      ) : (
        <div
          className={cn('h-full rounded-full transition-[width] duration-slow ease-out', barColor)}
          style={{ width: `${String(clamped * 100)}%` }}
        />
      )}
    </div>
  );
}
