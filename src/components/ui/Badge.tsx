import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'accent' | 'danger' | 'outline';

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  icon?: ReactNode;
  className?: string;
}

/**
 * Chips. `outline` is the mono chip for versions and numbers; `accent` is a
 * tinted label such as "Активный".
 */
const TONES: Readonly<Record<BadgeTone, string>> = {
  neutral: 'bg-[var(--chip)] text-text-dim',
  accent: 'bg-accent/[0.26] font-bold text-text',
  danger: 'bg-danger/15 text-danger',
  outline: 'bg-[var(--chip)] font-mono text-text-dim',
};

export function Badge({ children, tone = 'neutral', icon, className }: BadgeProps): ReactElement {
  return (
    <span
      className={cn(
        'inline-flex h-[21px] items-center gap-1 whitespace-nowrap rounded-pill px-2 text-[11px] font-medium',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
