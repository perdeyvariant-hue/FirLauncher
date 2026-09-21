import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

export interface ContextMenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly tone?: 'default' | 'danger';
  readonly disabled?: boolean;
  readonly separatorBefore?: boolean;
  readonly onSelect: () => void;
}

export interface ContextMenuProps {
  items: readonly ContextMenuItem[];
  children: ReactNode;
  className?: string;
}

interface Anchor {
  readonly x: number;
  readonly y: number;
}

const MENU_WIDTH = 190;
const EDGE_PADDING = 8;

/** Wraps a target and opens a menu at the cursor on right-click. */
export function ContextMenu({ items, children, className }: ContextMenuProps): ReactElement {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Anchor | null>(null);

  const close = useCallback(() => {
    setAnchor(null);
    setPosition(null);
  }, []);

  const openAt = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    setAnchor({ x: event.clientX, y: event.clientY });
  };

  // Flip the menu when it would overflow the window.
  useLayoutEffect(() => {
    if (anchor === null) return;
    const height = menuRef.current?.offsetHeight ?? 0;
    const x = Math.min(anchor.x, window.innerWidth - MENU_WIDTH - EDGE_PADDING);
    const y = Math.min(anchor.y, window.innerHeight - height - EDGE_PADDING);
    setPosition({ x: Math.max(EDGE_PADDING, x), y: Math.max(EDGE_PADDING, y) });
  }, [anchor]);

  useEffect(() => {
    if (anchor === null) return;
    const onDown = (): void => {
      close();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [anchor, close]);

  return (
    <>
      <div onContextMenu={openAt} className={className}>
        {children}
      </div>

      {anchor !== null &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
            style={{
              left: position?.x ?? anchor.x,
              top: position?.y ?? anchor.y,
              width: MENU_WIDTH,
              visibility: position === null ? 'hidden' : 'visible',
            }}
            className={cn(
              'fixed z-50 animate-scale-in overflow-hidden rounded-lg p-1',
              'border border-border bg-surface shadow-[var(--shadow-panel)]',
            )}
          >
            {items.map((item) => (
              <div key={item.id}>
                {item.separatorBefore === true && <div className="my-1 h-px bg-border" />}
                <button
                  type="button"
                  role="menuitem"
                  disabled={item.disabled ?? false}
                  onClick={() => {
                    close();
                    item.onSelect();
                  }}
                  className={cn(
                    'flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-xs',
                    'transition-colors duration-fast ease-out',
                    'disabled:pointer-events-none disabled:opacity-40',
                    item.tone === 'danger'
                      ? 'text-danger hover:bg-danger/10'
                      : 'text-text hover:bg-surface-2',
                  )}
                >
                  <span className="text-text-dim">{item.icon}</span>
                  {item.label}
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
