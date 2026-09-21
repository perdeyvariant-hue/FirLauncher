import { useId } from 'react';
import type { ReactElement } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SelectProps<T extends string> {
  value: T;
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  label?: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
  /** Rendered inside the control, before the value. */
  compact?: boolean;
}

/**
 * A native <select> skinned to the design system. Native beats a custom popup
 * here: keyboard behaviour, long version lists and OS scrolling come for free.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  hint,
  disabled = false,
  className,
  compact = false,
}: SelectProps<T>): ReactElement {
  const id = useId();

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label !== undefined && (
        <label htmlFor={id} className="text-xs font-medium text-text-dim">
          {label}
        </label>
      )}

      <div
        className={cn(
          'relative flex items-center rounded-lg border border-border bg-surface-2',
          'transition-[border-color] duration-fast ease-out focus-within:border-accent',
          compact ? 'h-8' : 'h-9',
          disabled && 'opacity-45',
        )}
      >
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.target.value as T);
          }}
          className={cn(
            'w-full appearance-none bg-transparent pl-2.5 pr-8 text-sm text-text outline-none',
            compact && 'text-xs',
          )}
        >
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled ?? false}
              className="bg-surface text-text"
            >
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          className="pointer-events-none absolute right-2.5 text-text-dim"
        />
      </div>

      {hint !== undefined && <p className="text-2xs text-text-dim">{hint}</p>}
    </div>
  );
}
