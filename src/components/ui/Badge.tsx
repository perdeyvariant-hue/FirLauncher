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
  neutral: 'bg-[rgb(var(--text-rgb)/0.08)] text-text-dim',
  accent: 'bg-accent/18 text-accent shadow-rim',
  danger: 'bg-danger/15 text-danger',
  outline: 'border border-[rgb(var(--text-rgb)/0.14)] text-text-dim',
};

export function Badge({ children, tone = 'neutral', icon, className }: BadgeProps): ReactElement {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-pill px-2 text-2xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
