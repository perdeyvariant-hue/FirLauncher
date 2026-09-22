import type { ReactElement, ReactNode } from 'react';

export interface SectionProps {
  title: string;
  description?: string;
  /** Rendered right of the title, e.g. a reset button. */
  aside?: ReactNode;
  children: ReactNode;
}

/** A titled panel grouping related settings. */
export function Section({ title, description, aside, children }: SectionProps): ReactElement {
  return (
    <section className="panel flex flex-col gap-4 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-semibold text-text">{title}</h2>
          {description !== undefined && (
            <p className="mt-1 text-2xs leading-relaxed text-text-dim">{description}</p>
          )}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
