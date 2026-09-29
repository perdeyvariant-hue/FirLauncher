import { useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { cn } from '@/lib/cn';

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface SegmentedProps<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  /** Stretch to the parent's width; otherwise as wide as the longest label needs. */
  fullWidth?: boolean;
  className?: string;
  label?: string;
}

const FAST = '320ms var(--ease-spring)';
const SLOW = '620ms var(--ease-spring)';

/**
 * A row of equal options with a raised thumb under the chosen one. The
 * thumb's leading edge moves first and the trailing edge catches up, so it
 * stretches toward the new choice like something soft.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  fullWidth = false,
  className,
  label,
}: SegmentedProps<T>): ReactElement {
  const count = Math.max(options.length, 1);
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  // Which way the thumb last moved decides which edge leads.
  const [motion, setMotion] = useState({ index, direction: 1 });
  if (motion.index !== index) setMotion({ index, direction: index > motion.index ? 1 : -1 });
  const direction = motion.index === index ? motion.direction : index > motion.index ? 1 : -1;

  const thumb: CSSProperties = {
    left: `calc(3px + (100% - 6px) * ${String(index / count)})`,
    right: `calc(3px + (100% - 6px) * ${String((count - index - 1) / count)})`,
    transition: direction > 0 ? `left ${SLOW}, right ${FAST}` : `left ${FAST}, right ${SLOW}`,
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'relative grid rounded-pill p-[3px]',
        'bg-[var(--chip)] shadow-[inset_0_1px_2px_rgb(0_0_0/0.18)]',
        fullWidth ? 'w-full' : 'w-fit',
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${String(count)}, minmax(0, 1fr))` }}
    >
      <div
        aria-hidden
        className="absolute bottom-[3px] top-[3px] rounded-pill [background:var(--seg)] shadow-[inset_0_0_0_1px_var(--seg-border),inset_0_1px_0_rgb(255_255_255/0.12),0_2px_8px_rgb(0_0_0/0.18)]"
        style={thumb}
      />
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => {
              onChange(option.value);
            }}
            className={cn(
              'relative h-7 min-w-0 truncate whitespace-nowrap px-2.5 text-[12.5px] transition-colors duration-fast',
              selected ? 'font-semibold text-text' : 'font-medium text-text-dim hover:text-text',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
