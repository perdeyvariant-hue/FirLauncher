import type { ReactElement } from 'react';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Required: the box has no visible text of its own. */
  label: string;
  /** Some but not all of a group are checked. */
  indeterminate?: boolean;
  disabled?: boolean;
}

export function Checkbox({
  checked,
  onChange,
  label,
  indeterminate = false,
  disabled = false,
}: CheckboxProps): ReactElement {
  const on = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => {
        onChange(!checked);
      }}
      className={cn(
        'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border',
        'transition-colors duration-fast ease-out disabled:pointer-events-none disabled:opacity-45',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        on
          ? 'border-transparent bg-[image:var(--accent-gradient)] text-white'
          : 'border-[var(--glass-border)] bg-[var(--field)] hover:border-text-dim',
      )}
    >
      {indeterminate ? (
        <Minus size={11} strokeWidth={2.5} />
      ) : checked ? (
        <Check size={11} strokeWidth={2.5} />
      ) : null}
    </button>
  );
}
