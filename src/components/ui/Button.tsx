import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  primary: 'bg-accent text-white hover:bg-accent-hover active:bg-accent-dim',
  secondary:
    'bg-surface-2 text-text border border-border hover:border-text-dim/40 hover:bg-surface-2/70',
  ghost: 'text-text-dim hover:text-text hover:bg-surface-2',
  danger: 'bg-danger/10 text-danger border border-danger/25 hover:bg-danger/20',
};

const SIZES: Readonly<Record<ButtonSize, string>> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-sm gap-2 rounded-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    icon,
    fullWidth = false,
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
        'inline-flex select-none items-center justify-center whitespace-nowrap font-medium',
        'transition-[background-color,border-color,color,opacity] duration-fast ease-out',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 size={size === 'sm' ? 13 : 15} strokeWidth={1.5} className="animate-spin-slow" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
});
