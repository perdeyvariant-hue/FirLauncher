import type { ReactElement } from 'react';
import { cn } from '@/lib/cn';

export interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps): ReactElement {
  return (
    <div
      aria-hidden
      className={cn('animate-fade-in rounded-md bg-surface-2/80', className)}
      style={{ animationDuration: '180ms' }}
    />
  );
}
