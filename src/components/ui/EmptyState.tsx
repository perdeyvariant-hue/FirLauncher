import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
}: EmptyStateProps): ReactElement {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 py-10' : 'gap-3 py-20',
        className,
      )}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-2 text-text-dim">
        {icon}
      </div>
      <div className="max-w-[320px]">
        <p className="text-sm font-medium text-text">{title}</p>
        {description !== undefined && (
          <p className="mt-1 text-xs leading-relaxed text-text-dim">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}
