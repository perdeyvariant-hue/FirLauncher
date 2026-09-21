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

export function Tabs<T extends string>({
  value,
  items,
  onChange,
  className,
}: TabsProps<T>): ReactElement {
  return (
    <div role="tablist" className={cn('flex items-center gap-0.5 overflow-x-auto', className)}>
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => {
              onChange(item.value);
            }}
            className={cn(
              'relative flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-xs font-medium',
              'transition-[color,background-color] duration-fast ease-out',
              selected ? 'text-text' : 'text-text-dim hover:bg-surface-2 hover:text-text',
            )}
          >
            {item.label}
            {item.badge !== undefined && item.badge > 0 && (
              <span
                className={cn(
                  'rounded px-1 text-2xs tabular-nums',
                  selected ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-text-dim',
                )}
              >
                {item.badge}
              </span>
            )}
            {selected && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />
            )}
          </button>
        );
      })}
    </div>
  );
}
