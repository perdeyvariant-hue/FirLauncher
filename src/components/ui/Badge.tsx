import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'accent' | 'danger' | 'outline';

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  icon?: ReactNode;
  className?: string;
}

const TONES: Readonly<Record<BadgeTone, string>> = {
  neutral: 'bg-surface-2 text-text-dim',
  accent: 'bg-accent/15 text-accent',
  danger: 'bg-danger/15 text-danger',
  outline: 'border border-border text-text-dim',
};

export function Badge({ children, tone = 'neutral', icon, className }: BadgeProps): ReactElement {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded px-1.5 text-2xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
