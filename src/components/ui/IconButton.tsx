import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only controls must stay reachable for screen readers. */
  label: string;
  icon: ReactNode;
  active?: boolean;
  tone?: 'default' | 'danger';
  size?: 'sm' | 'md';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, active = false, tone = 'default', size = 'md', className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-pill',
        'transition-[background-color,color,transform] duration-fast ease-spring',
        'active:scale-[0.9] disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'h-7 w-7' : 'h-9 w-9',
        tone === 'danger'
          ? 'text-text-dim hover:bg-danger/12 hover:text-danger'
          : active
            ? 'bg-accent/18 text-accent shadow-rim'
            : 'text-text-dim hover:bg-[rgb(var(--text-rgb)/0.08)] hover:text-text',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
});
