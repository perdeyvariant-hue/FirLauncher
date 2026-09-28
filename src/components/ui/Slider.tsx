import { useId, useState } from 'react';
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
  /** Quieter text after the value, e.g. "≈ 4 ГБ из 32 ГБ". */
  valueHint?: string;
  /** Optional marker (0..1) drawn on the track, e.g. recommended RAM. */
  marks?: readonly { readonly at: number; readonly title: string }[];
  disabled?: boolean;
}

/**
 * A glowing track with a pearl thumb. While dragged the thumb swells and
 * turns to glass so the value under it stays visible. The native range
 * input underneath does the work, so keys and screen readers behave.
 */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  valueLabel,
  valueHint,
  marks = [],
  disabled = false,
}: SliderProps): ReactElement {
  const id = useId();
  const [dragging, setDragging] = useState(false);
  const ratio = max > min ? (value - min) / (max - min) : 0;
  const percent = `${String(Math.min(Math.max(ratio, 0), 1) * 100)}%`;
  const release = (): void => {
    setDragging(false);
  };

  return (
    <div className={cn('flex flex-col', disabled && 'pointer-events-none opacity-45')}>
      {(label !== undefined || valueLabel !== undefined) && (
        <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
          {label !== undefined && (
            <label htmlFor={id} className="text-text-dim">
              {label}
            </label>
          )}
          {valueLabel !== undefined && (
            <span className="shrink-0">
              <span className="font-mono text-xs font-medium tabular-nums text-text">{valueLabel}</span>
              {valueHint !== undefined && (
                <span className="ml-1.5 text-[11.5px] text-text-faint">{valueHint}</span>
              )}
            </span>
          )}
        </div>
      )}

      <div className="relative h-[30px] w-full">
        <div className="absolute inset-x-0 top-3 h-1.5 rounded-pill bg-[var(--track)] shadow-[inset_0_1px_2px_rgb(0_0_0/0.25)]" />
        <div
          className="absolute left-0 top-3 h-1.5 rounded-pill bg-[image:var(--accent-gradient)] shadow-[0_0_12px_rgb(var(--accent-rgb)/0.45)]"
          style={{ width: percent }}
        />
        {marks.map((mark) => (
          <span
            key={mark.title}
            title={mark.title}
            className="absolute top-2.5 h-2.5 w-px bg-text-dim/50"
            style={{ left: `${String(Math.min(Math.max(mark.at, 0), 1) * 100)}%` }}
          />
        ))}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-[15px] -translate-x-1/2 -translate-y-1/2 rounded-pill',
            'shadow-[0_2px_8px_rgb(0_0_0/0.3),inset_0_1px_0_rgb(255_255_255/0.95),0_0_0_0.5px_rgb(0_0_0/0.1)]',
            dragging
              ? 'bg-white/[0.38] backdrop-blur-[5px] backdrop-saturate-[1.8]'
              : 'bg-gradient-to-b from-white to-[#eeeaf6]',
          )}
          style={{
            left: percent,
            width: dragging ? 30 : 22,
            height: dragging ? 30 : 22,
            transition: 'width 400ms var(--ease-spring), height 400ms var(--ease-spring), background 200ms',
          }}
        />
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onPointerDown={() => {
            setDragging(true);
          }}
          onPointerUp={release}
          onPointerCancel={release}
          onBlur={release}
          onChange={(event) => {
            onChange(Number(event.target.value));
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
    </div>
  );
}
