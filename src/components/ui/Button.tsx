import { forwardRef, useRef } from 'react';
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'glass' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Capsules. The primary action is lit: a gradient between the accent and its
 * cooler neighbour. Secondary actions are outlines drawn in the glass rim,
 * `glass` is a pane of the same material as the cards, `ghost` is text.
 */
const VARIANTS: Readonly<Record<ButtonVariant, string>> = {
  primary:
    'bg-[image:var(--accent-gradient)] font-semibold text-white shadow-glow hover:brightness-110',
  secondary: 'bg-transparent text-text shadow-rim hover:bg-[var(--hover)]',
  glass:
    '[background:var(--glass)] text-text shadow-[inset_0_0_0_1px_var(--glass-border),inset_0_1px_0_rgb(255_255_255/0.18)] backdrop-blur-[30px] hover:brightness-110',
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
  /**
   * The one main action on a screen: the three accents turn slowly inside it
   * and light crosses it when the pointer arrives. Overrides `variant`.
   */
  iridescent?: boolean;
  /** Kept for callers of the old launch button; same as `iridescent`. */
  sheen?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    icon,
    fullWidth = false,
    iridescent = false,
    sheen = false,
    className,
    children,
    disabled,
    type = 'button',
    onMouseEnter,
    ...rest
  },
  ref,
) {
  const lit = iridescent || sheen;
  const sheenRef = useRef<HTMLSpanElement>(null);

  const sweep = (event: MouseEvent<HTMLButtonElement>): void => {
    onMouseEnter?.(event);
    if (!lit || document.documentElement.classList.contains('reduce-motion')) return;
    sheenRef.current?.animate(
      [
        { transform: 'translateX(-160%) skewX(-20deg)' },
        { transform: 'translateX(320%) skewX(-20deg)' },
      ],
      { duration: 750, easing: 'cubic-bezier(.3,.7,.2,1)' },
    );
  };

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled === true || loading}
      onMouseEnter={sweep}
      className={cn(
        'relative inline-flex select-none items-center justify-center',
        'whitespace-nowrap rounded-pill font-medium',
        'transition-[background-color,color,opacity,transform,box-shadow,filter]',
        'duration-fast ease-out active:scale-[0.96]',
        'disabled:pointer-events-none disabled:opacity-45',
        lit ? 'iridescent font-semibold' : VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {lit && (
        <span
          ref={sheenRef}
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-[-1] w-[45%] bg-gradient-to-r from-transparent via-white/55 to-transparent"
          style={{ transform: 'translateX(-160%) skewX(-20deg)' }}
        />
      )}
      {loading ? (
        <Loader2 size={size === 'sm' ? 13 : 15} strokeWidth={1.75} className="animate-spin-slow" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
});
