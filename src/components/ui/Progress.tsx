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
  const barColor = tone === 'danger' ? 'bg-danger' : 'bg-[image:var(--accent-gradient)]';

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped === null ? undefined : Math.round(clamped * 100)}
      className={cn(
        'relative w-full overflow-hidden rounded-pill bg-[var(--track)]',
        size === 'xs' ? 'h-[5px]' : 'h-1.5',
        className,
      )}
    >
      {clamped === null ? (
        <div className={cn('absolute inset-y-0 w-1/3 animate-indeterminate rounded-full', barColor)} />
      ) : (
        <div
          className={cn(
            'relative h-full overflow-hidden rounded-pill transition-[width] duration-slow ease-linear',
            barColor,
          )}
          style={{ width: `${String(clamped * 100)}%` }}
        >
          {/* Light running along the filled part while work goes on. */}
          {clamped < 1 && (
            <span className="absolute inset-y-0 w-2/5 animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent" />
          )}
        </div>
      )}
    </div>
  );
}
