import { useEffect, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Dialog } from '@/components/ui/Dialog';
import { ErrorBlock } from '@/components/ui/ErrorBlock';
import { Skeleton } from '@/components/ui/Skeleton';
import * as modsApi from '@/api/mods';
import type { OptimizePlan } from '@/api/mods';
import { useAsyncData } from '@/lib/useAsyncData';
import type { Instance } from '@/types/instance';
import { useToasts } from '@/store/useToasts';
import { t } from '@/lib/i18n';

export interface OptimizeDialogProps {
  instance: Instance;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

function Row({
  checked,
  disabled,
  onChange,
  label,
  children,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex items-start gap-3 rounded-md bg-surface-2 px-3 py-2.5">
      <div className="pt-0.5">
        <Checkbox checked={checked} disabled={disabled} onChange={onChange} label={label} />
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** One button for a faster instance: performance mods, memory and JVM flags. */
export function OptimizeDialog({ instance, open, onClose, onDone }: OptimizeDialogProps): ReactElement {
  const plan = useAsyncData<OptimizePlan | null>(
    () => (open ? modsApi.optimizePlan(instance.id) : Promise.resolve(null)),
    [open, instance.id],
  );
  const notify = useToasts((state) => state.notify);
  const fail = useToasts((state) => state.fail);

  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [memory, setMemory] = useState(true);
  const [flags, setFlags] = useState(true);
  const [busy, setBusy] = useState(false);

  // Everything available and missing starts ticked.
  useEffect(() => {
    const data = plan.data;
    if (data === null) return;
    setChosen(new Set(data.mods.filter((m) => !m.installed && m.versionNumber !== null).map((m) => m.projectId)));
    setMemory(data.recommendedMemoryMb !== data.currentMemoryMb);
    setFlags(data.recommendedJvmArgs !== data.currentJvmArgs);
  }, [plan.data]);

  const data = plan.data;

  const apply = async (): Promise<void> => {
    if (data === null) return;
    setBusy(true);
    try {
      await modsApi.applyOptimize(
        instance.id,
        [...chosen],
        memory ? data.recommendedMemoryMb : null,
        flags ? data.recommendedJvmArgs : null,
      );
      notify(
        chosen.size > 0 ? t`Установлено модов: ${String(chosen.size)}. Сборка оптимизирована` : t`Настройки применены`,
        'success',
      );
      onDone();
      onClose();
    } catch (raw) {
      fail(raw);
    }
    setBusy(false);
  };

  const nothing = data !== null && chosen.size === 0 && !memory && !flags;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="md"
      title={t`Оптимизировать сборку`}
      description={t`Проверенные моды производительности под эту версию и лоадер, плюс память и флаги Java.`}
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t`Отмена`}</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={data === null || nothing}
            onClick={() => {
              void apply();
            }}
          >
            {t`Применить`}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 py-2">
        {plan.error !== null ? (
          <ErrorBlock error={plan.error} onRetry={plan.reload} />
        ) : data === null ? (
          Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-12" />)
        ) : (
          <>
            {data.mods.map((mod) => {
              const unavailable = mod.versionNumber === null;
              return (
                <Row
                  key={mod.projectId}
                  label={mod.name}
                  checked={mod.installed || chosen.has(mod.projectId)}
                  disabled={mod.installed || unavailable || busy}
                  onChange={(on) => {
                    setChosen((current) => {
                      const next = new Set(current);
                      if (on) next.add(mod.projectId);
                      else next.delete(mod.projectId);
                      return next;
                    });
                  }}
                >
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium text-text">{mod.name}</p>
                    {mod.installed ? (
                      <Badge tone="accent" icon={<Check size={10} strokeWidth={2.5} />}>
                        {t`уже стоит`}</Badge>
                    ) : unavailable ? (
                      <Badge tone="outline">{t`нет под `}{instance.mcVersion}</Badge>
                    ) : (
                      <span className="font-mono text-2xs text-text-dim">{mod.versionNumber}</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-2xs text-text-dim">{mod.about}</p>
                </Row>
              );
            })}

            <Row
              label={t`Память`}
              checked={memory}
              disabled={busy || data.recommendedMemoryMb === data.currentMemoryMb}
              onChange={setMemory}
            >
              <p className="text-xs font-medium text-text">
                {t`Память: `}{data.recommendedMemoryMb} {t` МБ`}<span className="font-normal text-text-dim"> {t` (сейчас `}{data.currentMemoryMb} {t` МБ)`}</span>
              </p>
              <p className="mt-0.5 text-2xs text-text-dim">
                {t`Подобрано по числу модов и не больше половины памяти компьютера.`}</p>
            </Row>

            <Row
              label={t`Флаги JVM`}
              checked={flags}
              disabled={busy || data.recommendedJvmArgs === data.currentJvmArgs}
              onChange={setFlags}
            >
              <p className="text-xs font-medium text-text">{t`Оптимальные флаги Java`}</p>
              <p className="mt-0.5 text-2xs text-text-dim">
                {t`Сборщик мусора G1 с короткими паузами — меньше подлагиваний. Старые флаги сборки заменятся.`}</p>
            </Row>
          </>
        )}
      </div>
    </Dialog>
  );
}
