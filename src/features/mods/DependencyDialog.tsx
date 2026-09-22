import type { ReactElement } from 'react';
import { AlertTriangle, Link2, Package } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { formatBytes } from '@/lib/format';
import type { ContentKind } from '@/api/mods';
import type { ModVersion, ResolvedInstallPlan } from '@/types/mod';
import { t } from '@/lib/i18n';

export interface DependencyDialogProps {
  plan: ResolvedInstallPlan | null;
  kind: ContentKind;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function Row({ version, primary }: { version: ModVersion; primary: boolean }): ReactElement {
  return (
    <li className="flex items-center gap-2.5 rounded-md bg-surface-2 px-3 py-2">
      <span className="text-text-dim">
        {primary ? <Package size={14} strokeWidth={1.5} /> : <Link2 size={14} strokeWidth={1.5} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-text">{version.name}</p>
        <p className="truncate font-mono text-2xs text-text-dim">{version.fileName}</p>
      </div>
      <span className="shrink-0 font-mono text-2xs text-text-dim">
        {formatBytes(version.sizeBytes)}
      </span>
    </li>
  );
}

/** Shown before installing a mod that brings other files with it. */
export function DependencyDialog({
  plan,
  kind,
  busy,
  onConfirm,
  onCancel,
}: DependencyDialogProps): ReactElement {
  const files = plan === null ? 0 : 1 + plan.dependencies.length;
  // Packs never pull files in; what they need are mods for the Mods tab.
  const isMod = kind === 'mod';
  return (
    <Dialog
      open={plan !== null}
      onClose={onCancel}
      title={plan === null ? '' : t`Установить ${plan.primary.name}?`}
      description={
        isMod
          ? t`Этому моду нужны другие — они установятся вместе с ним.`
          : t`Для работы нужны моды — сами они не поставятся.`
      }
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t`Отмена`}</Button>
          <Button variant="primary" onClick={onConfirm} loading={busy}>
            {t`Установить (`}{files})
          </Button>
        </>
      }
    >
      {plan !== null && (
        <div className="flex flex-col gap-3 py-2">
          <ul className="flex flex-col gap-1.5">
            <Row version={plan.primary} primary />
            {plan.dependencies.map((version) => (
              <Row key={version.versionId} version={version} primary={false} />
            ))}
          </ul>

          {plan.unresolved.length > 0 && (
            <div className="flex gap-2.5 rounded-md border border-danger/35 bg-danger/5 p-3">
              <AlertTriangle size={14} strokeWidth={1.5} className="mt-px shrink-0 text-danger" />
              <div className="min-w-0">
                <p className="text-xs text-text">
                  {isMod
                    ? t`Не нашлись совместимые версии — без них мод может не запуститься:`
                    : t`Поставьте эти моды во вкладке «Моды», иначе пак будет работать не полностью:`}
                </p>
                <p className="mt-1 text-2xs leading-relaxed text-text-dim">
                  {plan.unresolved.map((dep) => dep.name ?? dep.projectId).join(', ')}
                </p>
              </div>
            </div>
          )}

          <p className="text-right font-mono text-2xs text-text-dim">
            {t`Всего `}{formatBytes(plan.totalBytes)}
          </p>
        </div>
      )}
    </Dialog>
  );
}
