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
    <div role="tablist" className={cn('no-scrollbar flex items-center gap-1 overflow-x-auto', className)}>
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
              'relative flex h-8 shrink-0 items-center gap-1.5 rounded-pill px-3.5 text-xs font-medium',
              'transition-[color,background-color,transform] duration-fast ease-spring',
              'active:scale-[0.96]',
              selected
                ? 'bg-[rgb(var(--text-rgb)/0.1)] text-text shadow-rim'
                : 'text-text-dim hover:bg-[rgb(var(--text-rgb)/0.06)] hover:text-text',
            )}
          >
            {item.label}
            {item.badge !== undefined && item.badge > 0 && (
              <span
                className={cn(
                  'rounded-pill px-1.5 text-2xs tabular-nums',
                  selected ? 'bg-accent/18 text-accent' : 'bg-[rgb(var(--text-rgb)/0.08)] text-text-dim',
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
