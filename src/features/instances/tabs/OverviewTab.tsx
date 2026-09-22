import type { ReactElement, ReactNode } from 'react';
import { Clock, FolderOpen, HardDrive, Package, Server } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import * as instancesApi from '@/api/instances';
import { formatPlaytime, formatRelativeDate } from '@/lib/format';
import type { Instance } from '@/types/instance';
import { LOADER_LABELS } from '@/types/instance';
import { useToasts } from '@/store/useToasts';
import { ModpackCard } from '../ModpackCard';
import { t } from '@/lib/i18n';

function Stat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}): ReactElement {
  return (
    <div className="panel flex items-center gap-3 p-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-dim">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-2xs text-text-dim">{label}</p>
        <p className="truncate text-sm text-text">{value}</p>
      </div>
    </div>
  );
}

export function OverviewTab({ instance }: { instance: Instance }): ReactElement {
  const fail = useToasts((state) => state.fail);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        <Stat
          icon={<Server size={16} strokeWidth={1.5} />}
          label={t`Версия`}
          value={instance.mcVersion}
        />
        <Stat
          icon={<Package size={16} strokeWidth={1.5} />}
          label={t`Модлоадер`}
          value={
            instance.loader === 'vanilla'
              ? t`Без лоадера`
              : `${LOADER_LABELS[instance.loader]} ${instance.loaderVersion ?? ''}`.trim()
          }
        />
        <Stat
          icon={<Clock size={16} strokeWidth={1.5} />}
          label={t`Время в игре`}
          value={
            instance.totalPlaySeconds > 0
              ? formatPlaytime(instance.totalPlaySeconds)
              : t`ещё не запускалась`
          }
        />
        <Stat
          icon={<HardDrive size={16} strokeWidth={1.5} />}
          label={t`Последний запуск`}
          value={formatRelativeDate(instance.lastPlayedAt)}
        />
      </div>

      <ModpackCard instance={instance} />

      <div className="panel flex flex-col gap-3 p-4">
        <div>
          <h3 className="text-xs font-semibold text-text">{t`Папка сборки`}</h3>
          <p className="mt-1 text-xs leading-relaxed text-text-dim">
            {t`Каждая сборка полностью изолирована: свои `}<code className="font-mono">mods/</code>,{' '}
            <code className="font-mono">config/</code>, <code className="font-mono">saves/</code>,{' '}
            <code className="font-mono">resourcepacks/</code> {t` и `}<code className="font-mono">logs/</code>.
          </p>
        </div>
        <div>
          <Button
            size="sm"
            icon={<FolderOpen size={14} strokeWidth={1.5} />}
            onClick={() => {
              void instancesApi.openInstanceFolder(instance.id).catch((raw: unknown) => fail(raw));
            }}
          >
            {t`Открыть папку`}</Button>
        </div>
      </div>
    </div>
  );
}
