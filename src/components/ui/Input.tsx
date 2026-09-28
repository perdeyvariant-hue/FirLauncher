import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string | null;
  leading?: ReactNode;
  trailing?: ReactNode;
  monospace?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, leading, trailing, monospace = false, className, id, ...rest },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hasError = error !== undefined && error !== null && error !== '';

  return (
    <div className="flex flex-col gap-1.5">
      {label !== undefined && (
        <label htmlFor={inputId} className="text-[13px] text-text-dim">
          {label}
        </label>
      )}

      <div
        className={cn(
          'field flex h-9 items-center gap-2 rounded-pill px-3.5',
          'transition-shadow duration-fast ease-out',
          'focus-within:shadow-[inset_0_0_0_1px_var(--glass-border),0_0_0_3px_rgb(var(--accent-rgb)/0.35)]',
          hasError && 'shadow-[inset_0_0_0_1px_rgb(var(--danger-rgb))]',
        )}
      >
        {leading !== undefined && <span className="shrink-0 text-text-dim">{leading}</span>}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={hasError}
          className={cn(
            'min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none',
            'placeholder:text-text-faint',
            monospace && 'font-mono text-xs',
            className,
          )}
          {...rest}
        />
        {trailing !== undefined && <span className="shrink-0 text-text-dim">{trailing}</span>}
      </div>

      {hasError ? (
        <p className="text-2xs text-danger">{error}</p>
      ) : hint !== undefined ? (
        <p className="text-xs text-text-faint">{hint}</p>
      ) : null}
    </div>
  );
});
