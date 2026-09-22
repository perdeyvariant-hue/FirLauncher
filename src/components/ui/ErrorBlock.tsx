import { useState } from 'react';
import type { ReactElement } from 'react';
import { AlertCircle, ChevronDown, RotateCw } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { LauncherError } from '@/types/error';
import { Button } from './Button';
import { t } from '@/lib/i18n';

export interface ErrorBlockProps {
  error: LauncherError;
  onRetry?: () => void;
  className?: string;
}

/** Inline error surface for panes that failed to load. */
export function ErrorBlock({ error, onRetry, className }: ErrorBlockProps): ReactElement {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-danger/35 bg-danger/5 p-4',
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <AlertCircle size={16} strokeWidth={1.5} className="mt-px shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-text">{error.message}</p>

          {error.detail !== undefined && (
            <>
              <button
                type="button"
                onClick={() => {
                  setExpanded((value) => !value);
                }}
                className="mt-1.5 inline-flex items-center gap-1 text-2xs text-text-dim hover:text-text"
              >
                <ChevronDown
                  size={12}
                  strokeWidth={1.5}
                  className={cn('transition-transform duration-fast', expanded && 'rotate-180')}
                />
                {t`Подробности`}</button>
              {expanded && (
                <pre className="selectable mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 font-mono text-2xs leading-relaxed text-text-dim">
                  {error.detail}
                </pre>
              )}
            </>
          )}
        </div>
      </div>

      {onRetry !== undefined && (
        <div className="flex justify-end">
          <Button size="sm" icon={<RotateCw size={13} strokeWidth={1.5} />} onClick={onRetry}>
            {t`Повторить`}</Button>
        </div>
      )}
    </div>
  );
}
