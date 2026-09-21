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
        <label htmlFor={inputId} className="text-xs font-medium text-text-dim">
          {label}
        </label>
      )}

      <div
        className={cn(
          'flex h-9 items-center gap-2 rounded-lg border bg-surface-2 px-2.5',
          'transition-[border-color] duration-fast ease-out',
          'focus-within:border-accent',
          hasError ? 'border-danger' : 'border-border',
        )}
      >
        {leading !== undefined && <span className="shrink-0 text-text-dim">{leading}</span>}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={hasError}
          className={cn(
            'min-w-0 flex-1 bg-transparent text-sm text-text outline-none',
            'placeholder:text-text-dim/70',
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
        <p className="text-2xs text-text-dim">{hint}</p>
      ) : null}
    </div>
  );
});
