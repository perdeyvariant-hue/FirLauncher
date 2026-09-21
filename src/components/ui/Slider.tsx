import { useId } from 'react';
import type { ReactElement } from 'react';
import { cn } from '@/lib/cn';

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  label?: string;
  /** Rendered right of the label, e.g. "4096 МБ". */
  valueLabel?: string;
  /** Optional marker (0..1) drawn on the track, e.g. recommended RAM. */
  marks?: readonly { readonly at: number; readonly title: string }[];
  disabled?: boolean;
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  valueLabel,
  marks = [],
  disabled = false,
}: SliderProps): ReactElement {
  const id = useId();
  const ratio = max > min ? (value - min) / (max - min) : 0;
  const percent = `${String(Math.min(Math.max(ratio, 0), 1) * 100)}%`;

  return (
    <div className={cn('flex flex-col gap-2', disabled && 'opacity-45')}>
      {(label !== undefined || valueLabel !== undefined) && (
        <div className="flex items-baseline justify-between">
          {label !== undefined && (
            <label htmlFor={id} className="text-xs font-medium text-text-dim">
              {label}
            </label>
          )}
          {valueLabel !== undefined && (
            <span className="font-mono text-xs tabular-nums text-text">{valueLabel}</span>
          )}
        </div>
      )}

      <div className="relative flex h-5 items-center">
        <div className="absolute inset-x-0 h-1 rounded-full bg-surface-2" />
        <div
          className="absolute left-0 h-1 rounded-full bg-accent"
          style={{ width: percent }}
        />
        {marks.map((mark) => (
          <span
            key={mark.title}
            title={mark.title}
            className="absolute h-2 w-px bg-text-dim/50"
            style={{ left: `${String(Math.min(Math.max(mark.at, 0), 1) * 100)}%` }}
          />
        ))}
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            onChange(Number(event.target.value));
          }}
          className={cn(
            'relative z-10 h-5 w-full cursor-pointer appearance-none bg-transparent',
            '[&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5',
            '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full',
            '[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--bg)]',
            '[&::-webkit-slider-thumb]:bg-accent',
            '[&::-webkit-slider-thumb]:transition-transform',
            'hover:[&::-webkit-slider-thumb]:scale-110',
            '[&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5',
            '[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0',
            '[&::-moz-range-thumb]:bg-accent',
          )}
        />
      </div>
    </div>
  );
}
