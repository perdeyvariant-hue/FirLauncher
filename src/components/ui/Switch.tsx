import { useId, useState } from 'react';
import type { ReactElement } from 'react';
import { cn } from '@/lib/cn';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}

/**
 * A capsule toggle. Pressing it squeezes the knob wider and turns it to
 * glass, the way a finger flattens a drop; letting go springs it across.
 * The text sits on the left and the toggle on the right, settings-row style.
 */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: SwitchProps): ReactElement {
  const id = useId();
  const [pressed, setPressed] = useState(false);
  const release = (): void => {
    setPressed(false);
  };

  const toggle = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        onChange(!checked);
      }}
      onPointerDown={() => {
        setPressed(true);
      }}
      onPointerUp={release}
      onPointerLeave={release}
      className={cn(
        'relative h-[30px] w-[52px] shrink-0 rounded-pill transition-[background] duration-slow ease-out',
        'shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1),inset_0_1px_3px_rgb(0_0_0/0.25)]',
        'disabled:pointer-events-none disabled:opacity-45',
        checked ? 'bg-[image:var(--accent-gradient)]' : 'bg-[var(--track)]',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-[3px] block h-6 rounded-pill',
          'shadow-[0_2px_6px_rgb(0_0_0/0.28),inset_0_1px_0_rgb(255_255_255/0.95),0_0_0_0.5px_rgb(0_0_0/0.08)]',
          pressed
            ? 'bg-white/[0.42] backdrop-blur-[4px] backdrop-saturate-[1.8]'
            : 'bg-gradient-to-b from-white to-[#efedf6]',
        )}
        style={{
          left: checked ? (pressed ? 15 : 25) : 3,
          width: pressed ? 34 : 24,
          transition:
            'left 500ms var(--ease-spring), width 350ms var(--ease-spring), background 200ms',
        }}
      />
    </button>
  );

  if (label === undefined && description === undefined) return toggle;

  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        {label !== undefined && (
          <span className="block text-[13.5px] font-medium text-text">{label}</span>
        )}
        {description !== undefined && (
          <span className="mt-0.5 block text-xs leading-relaxed text-text-faint">
            {description}
          </span>
        )}
      </label>
      {toggle}
    </div>
  );
}
