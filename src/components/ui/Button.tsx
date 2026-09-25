import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Controls are capsules of the same material family as the panels they sit
 * on: the primary action is solid accent lit from above, everything else is
 * glass or nothing at all.
 */
const VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  primary:
    'bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-dim ' +
    'shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_6px_16px_rgb(var(--accent-rgb)/0.35)]',
  secondary: 'glass-quiet text-text hover:bg-[rgb(var(--text-rgb)/0.1)]',
  ghost: 'text-text-dim hover:bg-[rgb(var(--text-rgb)/0.08)] hover:text-text',
  danger: 'bg-danger/12 text-danger shadow-rim hover:bg-danger/20',
};

const SIZES: Readonly<Record<ButtonSize, string>> = {
  sm: 'h-7 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  lg: 'h-11 px-6 text-sm gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
  /** One pass of light across the button on hover. For the launch button. */
  sheen?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    icon,
    fullWidth = false,
    sheen = false,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled === true || loading}
      className={cn(
        'group relative inline-flex select-none items-center justify-center overflow-hidden',
        'whitespace-nowrap rounded-pill font-medium',
        'transition-[background-color,border-color,color,opacity,transform,box-shadow]',
        'duration-fast ease-spring active:scale-[0.96]',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {sheen && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-y-0 left-0 w-1/4 opacity-0',
            'bg-gradient-to-r from-transparent via-white/40 to-transparent',
            'group-hover:animate-sheen group-hover:opacity-100',
          )}
        />
      )}
      {loading ? (
        <Loader2 size={size === 'sm' ? 13 : 15} strokeWidth={1.5} className="animate-spin-slow" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
});
