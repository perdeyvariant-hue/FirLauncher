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
        compact ? 'gap-2 py-10' : 'mx-auto mt-[70px] max-w-[380px] gap-2.5',
        className,
      )}
    >
      <div
        className={cn(
          'glass flex items-center justify-center text-accent [&_svg]:stroke-[1.6]',
          compact ? 'h-12 w-12 rounded-[16px]' : 'h-[72px] w-[72px] rounded-[24px] [&_svg]:h-[30px] [&_svg]:w-[30px]',
        )}
      >
        {icon}
      </div>
      <div className="max-w-[380px]">
        <p className={cn('font-bold text-text', compact ? 'text-[15px]' : 'mt-1.5 text-[19px]')}>{title}</p>
        {description !== undefined && (
          <p className="mt-1 text-pretty text-[13.5px] leading-normal text-text-dim">{description}</p>
        )}
      </div>
      {action !== undefined && <div className="mt-2.5 flex gap-2">{action}</div>}
    </div>
  );
}
