import type { ReactElement } from 'react';
import { t } from '@/lib/i18n';

/** How many files a content tab holds, beside its toolbar. */
export function ContentCount({ total, disabled = 0 }: { total: number; disabled?: number }): ReactElement | null {
  if (total === 0) return null;
  return (
    <span className="glass-quiet rounded-pill px-2.5 py-1 text-2xs tabular-nums text-text-dim">
      {t`Установлено: ${String(total)}`}
      {disabled > 0 && <span className="text-text-dim/70">{t` · выключено: ${String(disabled)}`}</span>}
    </span>
  );
}
