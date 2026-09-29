import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'glass' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Capsules. The primary action is filled with the accent and nothing more;
 * secondary actions are outlines drawn in the glass rim, `glass` is a pane
 * of the same material as the cards, `ghost` is text.
 */
const VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  primary:
    'bg-accent font-semibold text-on-accent shadow-[inset_0_1px_0_rgb(255_255_255/0.16)] hover:bg-accent-hover',
  secondary: 'bg-transparent text-text shadow-rim hover:bg-[var(--hover)]',
  glass:
    '[background:var(--glass)] text-text shadow-[inset_0_0_0_1px_var(--glass-border)] backdrop-blur-[30px] hover:bg-[var(--hover)]',
  ghost: 'text-text-dim hover:bg-[var(--hover)] hover:text-text',
  danger: 'bg-danger/[0.18] font-semibold text-danger hover:bg-danger/25',
};

const SIZES: Readonly<Record<ButtonSize, string>> = {
  sm: 'h-8 px-3.5 text-[12.5px] gap-1.5',
  md: 'h-9 px-4 text-[13px] gap-[7px]',
  lg: 'h-11 px-6 text-sm gap-2',
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
        'relative inline-flex select-none items-center justify-center',
        'whitespace-nowrap rounded-pill font-medium',
        'transition-[background-color,color,opacity,transform,box-shadow]',
        'duration-fast ease-out active:scale-[0.97]',
        'disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 size={size === 'sm' ? 13 : 15} strokeWidth={1.75} className="animate-spin-slow" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
});
