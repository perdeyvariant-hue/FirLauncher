import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly badge?: number;
}

export interface TabsProps<T extends string> {
  value: T;
  items: readonly TabItem<T>[];
  onChange: (value: T) => void;
  className?: string;
}

interface Thumb {
  readonly left: number;
  readonly width: number;
  /** Which way it last moved: the leading edge moves first. */
  readonly direction: 1 | -1;
}

/**
 * Tabs as a segmented strip: a raised thumb slides under the open tab and
 * stretches toward the next one before its trailing edge catches up.
 */
export function Tabs<T extends string>({
  value,
  items,
  onChange,
  className,
}: TabsProps<T>): ReactElement {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const [thumb, setThumb] = useState<Thumb | null>(null);

  useLayoutEffect(() => {
    const measure = (): void => {
      const button = refs.current.get(value);
      if (button === undefined) return;
      setThumb((previous) => ({
        left: button.offsetLeft,
        width: button.offsetWidth,
        direction: previous === null || button.offsetLeft >= previous.left ? 1 : -1,
      }));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
    };
  }, [value, items]);

  const slow = '620ms var(--ease-spring)';
  const fast = '320ms var(--ease-spring)';

  return (
    <div
      role="tablist"
      className={cn(
        'no-scrollbar relative flex w-fit max-w-full items-center overflow-x-auto rounded-pill p-[3px]',
        'bg-[var(--chip)] shadow-[inset_0_1px_2px_rgb(0_0_0/0.18)]',
        className,
      )}
    >
      {thumb !== null && (
        <span
          aria-hidden
          className="absolute bottom-[3px] top-[3px] rounded-pill [background:var(--seg)] shadow-[inset_0_0_0_1px_var(--seg-border),inset_0_1px_0_rgb(255_255_255/0.35),0_2px_8px_rgb(0_0_0/0.18),0_0_22px_-6px_rgb(var(--accent-rgb))]"
          style={{
            left: thumb.left,
            width: thumb.width,
            // The edge in the direction of travel leads.
            transition:
              thumb.direction > 0 ? `left ${slow}, width ${fast}` : `left ${fast}, width ${slow}`,
          }}
        />
      )}
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            ref={(element) => {
              if (element === null) refs.current.delete(item.value);
              else refs.current.set(item.value, element);
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => {
              onChange(item.value);
            }}
            className={cn(
              'relative flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-pill px-3.5 text-[12.5px]',
              'transition-colors duration-fast',
              selected ? 'font-semibold text-text' : 'font-medium text-text-dim hover:text-text',
            )}
          >
            {item.label}
            {item.badge !== undefined && item.badge > 0 && (
              <span className="rounded-pill bg-accent/25 px-1.5 text-[10.5px] font-bold tabular-nums text-text">
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
