import { useId } from 'react';
import type { ReactElement } from 'react';
import { cn } from '@/lib/cn';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: SwitchProps): ReactElement {
  const id = useId();

  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => {
          onChange(!checked);
        }}
        className={cn(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors duration-fast ease-out',
          'disabled:pointer-events-none disabled:opacity-45',
          checked ? 'bg-accent' : 'bg-surface-2 border border-border',
        )}
      >
        <span
          className={cn(
            'absolute top-1/2 block h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white',
            'transition-transform duration-fast ease-out',
            checked ? 'translate-x-[18px]' : 'translate-x-[3px]',
          )}
        />
      </button>

      {(label !== undefined || description !== undefined) && (
        <label htmlFor={id} className="min-w-0 cursor-pointer">
          {label !== undefined && <span className="block text-sm text-text">{label}</span>}
          {description !== undefined && (
            <span className="mt-0.5 block text-xs leading-relaxed text-text-dim">
              {description}
            </span>
          )}
        </label>
      )}
    </div>
  );
}
