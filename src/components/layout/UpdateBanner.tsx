import type { ReactElement } from 'react';
import { ArrowUpCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { useUpdater } from '@/store/useUpdater';
import { t } from '@/lib/i18n';

/** A slim strip above the page when a newer launcher is out. */
export function UpdateBanner(): ReactElement | null {
  const phase = useUpdater((state) => state.phase);
  const update = useUpdater((state) => state.update);
  const progress = useUpdater((state) => state.progress);
  const dismissed = useUpdater((state) => state.dismissed);
  const install = useUpdater((state) => state.install);
  const dismiss = useUpdater((state) => state.dismiss);

  const visible =
    update !== null && !dismissed && (phase === 'available' || phase === 'downloading' || phase === 'failed');
  if (!visible) return null;

  const downloading = phase === 'downloading';
  return (
    <div className="hairline-b flex h-10 shrink-0 animate-slide-down items-center gap-3 bg-accent/10 px-6">
      <ArrowUpCircle size={15} strokeWidth={1.5} className="shrink-0 text-accent" />
      <p className="min-w-0 flex-1 truncate text-xs text-text">
        {t`Доступна FirLauncher `}{update.version}
        <span className="text-text-dim"> {t` · у вас `}{update.currentVersion}</span>
        {update.notes !== null && update.notes.trim() !== '' && (
          <span className="text-text-dim"> · {update.notes.split('\n')[0]}</span>
        )}
      </p>
      {downloading ? (
        <span className="font-mono text-2xs text-text-dim">
          {progress === null ? t`загрузка…` : `${String(Math.round(progress * 100))}%`}
        </span>
      ) : (
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            void install();
          }}
        >
          {phase === 'failed' ? t`Повторить` : t`Обновить и перезапустить`}
        </Button>
      )}
      {!downloading && (
        <IconButton label={t`Позже`} size="sm" icon={<X size={14} strokeWidth={1.5} />} onClick={dismiss} />
      )}
    </div>
  );
}
