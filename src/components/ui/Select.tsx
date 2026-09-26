import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
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
  compact?: boolean;
}

/** Where the popup goes, in viewport coordinates. */
interface Placement {
  left: number;
  top: number;
  minWidth: number;
  maxWidth: number;
  maxHeight: number;
}

const GAP = 6;
const MARGIN = 12;

function place(trigger: DOMRect): Placement {
  const below = window.innerHeight - trigger.bottom - GAP - MARGIN;
  const above = trigger.top - GAP - MARGIN;
  // Open downwards unless there is visibly more room the other way.
  const dropUp = below < 180 && above > below;
  const maxHeight = Math.min(288, Math.max(120, dropUp ? above : below));
  // The list may be wider than its trigger — labels must stay readable — so
  // it is only kept from running off the right edge.
  const maxWidth = Math.max(trigger.width, window.innerWidth - trigger.left - MARGIN);
  return {
    left: trigger.left,
    top: dropUp ? trigger.top - GAP - maxHeight : trigger.bottom + GAP,
    minWidth: trigger.width,
    maxWidth,
    maxHeight,
  };
}

/**
 * A list the launcher draws itself. The native <select> popup is painted by
 * Windows and ignores everything about the theme, which is exactly what it
 * looks like next to glass.
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });

  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [active, setActive] = useState(0);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex === -1 ? null : options[selectedIndex];

  const openList = (): void => {
    if (disabled || options.length === 0) return;
    const trigger = triggerRef.current;
    if (trigger === null) return;
    setPlacement(place(trigger.getBoundingClientRect()));
    setActive(selectedIndex === -1 ? 0 : selectedIndex);
    setOpen(true);
  };

  const choose = (index: number): void => {
    const option = options[index];
    if (option === undefined || option.disabled === true) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  // Keep the list under its trigger while the page moves beneath it.
  useLayoutEffect(() => {
    if (!open) return;
    const reposition = (): void => {
      const trigger = triggerRef.current;
      if (trigger !== null) setPlacement(place(trigger.getBoundingClientRect()));
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  // The active row follows the keyboard.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (!open) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault();
        openList();
      }
      return;
    }

    const step = (delta: number): void => {
      event.preventDefault();
      setActive((current) => {
        let next = current;
        for (let i = 0; i < options.length; i += 1) {
          next = (next + delta + options.length) % options.length;
          if (options[next]?.disabled !== true) break;
        }
        return next;
      });
    };

    switch (event.key) {
      case 'ArrowDown':
        step(1);
        break;
      case 'ArrowUp':
        step(-1);
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(active);
        break;
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      default: {
        // Type-ahead: long version lists are unusable without it.
        if (event.key.length !== 1) return;
        const now = Date.now();
        typed.current = {
          text: now - typed.current.at > 700 ? event.key : typed.current.text + event.key,
          at: now,
        };
        const needle = typed.current.text.toLowerCase();
        const found = options.findIndex((option) => option.label.toLowerCase().startsWith(needle));
        if (found !== -1) setActive(found);
      }
    }
  };

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label !== undefined && (
        <label htmlFor={id} className="text-xs font-medium text-text-dim">
          {label}
        </label>
      )}

      <button
        id={id}
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => {
          if (open) setOpen(false);
          else openList();
        }}
        onKeyDown={onKeyDown}
        className={cn(
          'relative flex w-full items-center rounded-pill pl-3.5 pr-8 text-left',
          'border border-[rgb(var(--text-rgb)/0.1)] bg-[rgb(var(--text-rgb)/0.05)]',
          'transition-[border-color,background-color] duration-fast ease-out',
          'hover:bg-[rgb(var(--text-rgb)/0.08)] focus-visible:border-accent',
          open && 'border-accent',
          compact ? 'h-8 text-xs' : 'h-9 text-sm',
          disabled && 'pointer-events-none opacity-45',
        )}
      >
        <span className="truncate text-text">{selected?.label ?? ''}</span>
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          className={cn(
            'pointer-events-none absolute right-3 text-text-dim transition-transform duration-fast',
            open && 'rotate-180',
          )}
        />
      </button>

      {hint !== undefined && <p className="text-2xs text-text-dim">{hint}</p>}

      {open &&
        placement !== null &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[60]"
              role="presentation"
              onMouseDown={() => {
                setOpen(false);
              }}
            />
            <div
              ref={listRef}
              role="listbox"
              aria-activedescendant={`${id}-${String(active)}`}
              tabIndex={-1}
              style={{
                left: placement.left,
                top: placement.top,
                minWidth: placement.minWidth,
                maxWidth: placement.maxWidth,
                maxHeight: placement.maxHeight,
              }}
              className="glass-sheet fixed z-[61] w-max animate-glass-in overflow-y-auto rounded-xl p-1"
            >
              {options.map((option, index) => {
                const isSelected = option.value === value;
                return (
                  <button
                    key={option.value}
                    id={`${id}-${String(index)}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-active={index === active}
                    disabled={option.disabled ?? false}
                    onMouseEnter={() => {
                      setActive(index);
                    }}
                    onClick={() => {
                      choose(index);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs',
                      'transition-colors duration-fast ease-out disabled:opacity-40',
                      index === active && 'bg-[rgb(var(--text-rgb)/0.09)]',
                      isSelected ? 'text-accent' : 'text-text',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {isSelected && <Check size={13} strokeWidth={2} className="shrink-0" />}
                  </button>
                );
              })}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
