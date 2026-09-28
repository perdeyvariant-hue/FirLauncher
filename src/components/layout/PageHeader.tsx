import { useState } from 'react';
import type { ReactElement, ReactNode, UIEvent } from 'react';
import { cn } from '@/lib/cn';

export interface PageProps {
  title: string;
  /** Quiet text beside the title, e.g. "9 сборок". */
  subtitle?: string;
  /** Right side of the header: the screen's actions. */
  actions?: ReactNode;
  children: ReactNode;
  /** Extra classes for the content column. */
  className?: string;
}

/**
 * A screen with a large title that folds into a floating glass bar once the
 * content scrolls, the way a big navigation title does on a phone.
 */
export function Page({ title, subtitle, actions, children, className }: PageProps): ReactElement {
  const [folded, setFolded] = useState(false);

  const onScroll = (event: UIEvent<HTMLDivElement>): void => {
    const next = event.currentTarget.scrollTop > 24;
    if (next !== folded) setFolded(next);
  };

  return (
    <div className="h-full overflow-y-auto" onScroll={onScroll}>
      <header
        className={cn(
          'sticky top-0 z-[5] flex items-center gap-3.5 rounded-[22px]',
          'transition-all duration-spring ease-spring',
          folded
            ? 'glass mx-4 my-2 ml-2 px-[18px] py-3'
            : 'mx-4 ml-2 bg-transparent px-5 pb-[18px] pl-3 pt-1.5',
        )}
      >
        <h1
          className={cn(
            'm-0 font-bold leading-[1.1] tracking-[-0.025em] text-text',
            'transition-[font-size] duration-spring ease-spring',
            folded ? 'text-xl' : 'text-[34px]',
          )}
        >
          {title}
        </h1>
        {subtitle !== undefined && (
          <span className="pt-1 text-sm font-medium text-text-dim">{subtitle}</span>
        )}
        <div className="flex-1" />
        {actions}
      </header>

      <div className={cn('pb-12 pl-5 pr-7 pt-1.5', className)}>{children}</div>
    </div>
  );
}
