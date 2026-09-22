import { useState } from 'react';
import type { ReactElement } from 'react';
import { ArrowUpCircle, Boxes, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import * as packsApi from '@/api/packs';
import { useAsyncData } from '@/lib/useAsyncData';
import type { Instance } from '@/types/instance';
import type { ModpackInfo, ModpackUpdate } from '@/types/pack';
import { useInstances } from '@/store/useInstances';
import { useToasts } from '@/store/useToasts';
import { t } from '@/lib/i18n';

/** "Which modpack is this, and is there a newer one?" — on the overview tab. */
export function ModpackCard({ instance }: { instance: Instance }): ReactElement | null {
  const info = useAsyncData<ModpackInfo | null>(() => packsApi.modpackInfo(instance.id), [instance.id]);
  const notify = useToasts((state) => state.notify);
  const fail = useToasts((state) => state.fail);
  const reloadInstances = useInstances((state) => state.load);

  const [update, setUpdate] = useState<ModpackUpdate | null>(null);
  const [checked, setChecked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);

  const pack = info.data;
  if (pack === null) return null;

  const check = async (): Promise<void> => {
    setChecking(true);
    try {
      const found = await packsApi.checkModpackUpdate(instance.id);
      setUpdate(found);
      setChecked(true);
      if (found === null) notify(t`Модпак последней версии`, 'success');
    } catch (raw) {
      fail(raw);
    }
    setChecking(false);
  };

  const apply = async (): Promise<void> => {
    setUpdating(true);
    try {
      const summary = await packsApi.updateModpack(instance.id);
      notify(
        summary.kept.length === 0
          ? t`Модпак обновлён до ${summary.version}`
          : t`Модпак обновлён до ${summary.version}. Ваши правки сохранены: ${String(summary.kept.length)} файл(ов)`,
        'success',
      );
      setUpdate(null);
      info.reload();
      void reloadInstances();
    } catch (raw) {
      fail(raw);
    }
    setUpdating(false);
  };

  return (
    <div className="panel flex items-center gap-3 p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-dim">
        <Boxes size={16} strokeWidth={1.5} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm text-text">{pack.name}</p>
          <Badge tone="outline">{pack.versionNumber}</Badge>
          {update !== null && <Badge tone="accent">→ {update.latest}</Badge>}
        </div>
        <p className="mt-0.5 text-2xs text-text-dim">
          {pack.updatable
            ? t`Модпак с Modrinth. При обновлении ваши моды, выключенные моды и правки конфигов сохраняются.`
            : t`Модпак импортирован из файла, которого нет на Modrinth, — автоматическое обновление недоступно.`}
        </p>
      </div>
      {pack.updatable &&
        (update === null ? (
          <Button
            size="sm"
            loading={checking}
            icon={<RefreshCw size={13} strokeWidth={1.5} />}
            onClick={() => {
              void check();
            }}
          >
            {checked ? t`Проверить снова` : t`Проверить обновление`}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            loading={updating}
            icon={<ArrowUpCircle size={14} strokeWidth={1.5} />}
            onClick={() => {
              void apply();
            }}
          >
            {t`Обновить до `}{update.latest}
          </Button>
        ))}
    </div>
  );
}
