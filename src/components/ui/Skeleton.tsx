import type { ReactElement } from 'react';
import { cn } from '@/lib/cn';

export interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps): ReactElement {
  return (
    <div
      aria-hidden
      className={cn('animate-fade-in rounded-xl bg-[var(--chip)]', className)}
      style={{ animationDuration: '180ms' }}
    />
  );
}
