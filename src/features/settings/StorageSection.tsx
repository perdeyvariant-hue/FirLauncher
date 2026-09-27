import { useState } from 'react';
import type { ReactElement } from 'react';
import { HardDrive, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Section } from '@/components/ui/Section';
import { Skeleton } from '@/components/ui/Skeleton';
import * as metaApi from '@/api/meta';
import type { CleanupPlan, StorageUsage } from '@/api/meta';
import { formatBytes } from '@/lib/format';
import { useAsyncData } from '@/lib/useAsyncData';
import { useToasts } from '@/store/useToasts';
import { t } from '@/lib/i18n';

function Row({ label, hint, bytes, indent = false }: { label: string; hint?: string; bytes: number; indent?: boolean }): ReactElement {
  return (
    <div className={indent ? 'flex items-baseline gap-3 pl-4' : 'flex items-baseline gap-3'}>
      <div className="min-w-0 flex-1">
        <p className={indent ? 'truncate text-xs text-text-dim' : 'truncate text-xs text-text'}>{label}</p>
        {hint !== undefined && <p className="text-2xs text-text-dim">{hint}</p>}
      </div>
      <span className="shrink-0 font-mono text-xs tabular-nums text-text-dim">{formatBytes(bytes)}</span>
    </div>
  );
}

/** How much the launcher takes, and taking back what nothing uses. */
export function StorageSection(): ReactElement {
  const usage = useAsyncData<StorageUsage>(() => metaApi.storageUsage(), []);
  const notify = useToasts((state) => state.notify);
  const fail = useToasts((state) => state.fail);

  const [plan, setPlan] = useState<CleanupPlan | null>(null);
  const [looking, setLooking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  const look = (): void => {
    setLooking(true);
    metaApi
      .planStorageCleanup()
      .then(setPlan)
      .catch((raw: unknown) => fail(raw))
      .finally(() => {
        setLooking(false);
      });
  };

  const clean = (): void => {
    setCleaning(true);
    metaApi
      .cleanStorage()
      .then((done) => {
        notify(t`Освобождено ${formatBytes(done.bytes)}`, 'success');
        setPlan(null);
        usage.reload();
      })
      .catch((raw: unknown) => fail(raw))
      .finally(() => {
        setCleaning(false);
        setConfirming(false);
      });
  };

  const data = usage.data;
  const instancesTotal = data?.instances.reduce((sum, item) => sum + item.bytes, 0) ?? 0;

  return (
    <Section
      title={t`Место на диске`}
      description={t`Сколько занимает лаунчер. Библиотеки и версии игры общие для сборок и остаются, когда сборку удаляют или переводят на другую версию.`}
    >
      {data === null ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-5" />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <HardDrive size={15} strokeWidth={1.5} className="text-accent" />
            <p className="text-sm font-medium text-text">{t`Всего ${formatBytes(data.total)}`}</p>
          </div>
          <Row label={t`Сборки: ${String(data.instances.length)}`} bytes={instancesTotal} />
          {data.instances.slice(0, 6).map((instance) => (
            <Row key={instance.id} label={instance.name} bytes={instance.bytes} indent />
          ))}
          <Row label={t`Ассеты`} hint={t`Звуки, языки и текстуры, общие для всех версий`} bytes={data.assets} />
          <Row label="Java" hint={t`Скачанные лаунчером среды, по одной на нужную версию`} bytes={data.java} />
          <Row label={t`Библиотеки`} bytes={data.libraries} />
          <Row label={t`Версии игры`} bytes={data.versions} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" loading={looking} icon={<Search size={13} strokeWidth={1.5} />} onClick={look}>
          {t`Найти лишнее`}</Button>
        {plan !== null &&
          (plan.blocked !== null ? (
            <p className="text-2xs text-danger">{plan.blocked}</p>
          ) : plan.files === 0 ? (
            <p className="text-2xs text-text-dim">{t`Лишнего нет — всё нужно хотя бы одной сборке.`}</p>
          ) : (
            <>
              <p className="text-2xs text-text-dim">
                {t`Можно освободить ${formatBytes(plan.bytes)} — файлов: ${String(plan.files)}`}</p>
              <Button
                size="sm"
                variant="danger"
                icon={<Trash2 size={13} strokeWidth={1.5} />}
                onClick={() => {
                  setConfirming(true);
                }}
              >
                {t`Удалить`}</Button>
            </>
          ))}
      </div>

      <ConfirmDialog
        open={confirming}
        destructive
        busy={cleaning}
        title={t`Удалить неиспользуемые файлы?`}
        description={t`Библиотеки и версии игры, на которые не ссылается ни одна сборка. Если понадобятся снова — скачаются при запуске. Файлы Forge и NeoForge, созданные при установке, не трогаются.`}
        confirmLabel={t`Удалить`}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={clean}
      />
    </Section>
  );
}
