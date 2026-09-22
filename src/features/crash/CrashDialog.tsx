import type { ReactElement } from 'react';
import { Check, FileText, HelpCircle, Play, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Skeleton } from '@/components/ui/Skeleton';
import { activeAccountOf, useAccounts } from '@/store/useAccounts';
import { useCrash } from '@/store/useCrash';
import { useInstances } from '@/store/useInstances';
import { useUI } from '@/store/useUI';
import type { CrashFix } from '@/types/crash';
import { t } from '@/lib/i18n';

function fixLabel(fix: CrashFix): string {
  switch (fix.type) {
    case 'installMods':
      return t`Установить ${fix.modIds.join(', ')}`;
    case 'useJava':
      return t`Запускать на Java ${String(fix.major)}`;
    case 'setMemory':
      return t`Выделить ${String(fix.memoryMb)} МБ`;
    case 'disableMods':
      return t`Выключить ${fix.modIds.join(', ')}`;
  }
}

/** Shown after a crash: what went wrong in plain words, and one-click fixes. */
export function CrashDialog(): ReactElement {
  const instanceId = useCrash((state) => state.instanceId);
  const analysis = useCrash((state) => state.analysis);
  const loading = useCrash((state) => state.loading);
  const applied = useCrash((state) => state.applied);
  const working = useCrash((state) => state.working);
  const close = useCrash((state) => state.close);
  const apply = useCrash((state) => state.apply);
  const instance = useInstances((state) =>
    state.instances.find((item) => item.id === instanceId),
  );
  const launch = useInstances((state) => state.launch);
  const account = useAccounts(activeAccountOf);
  const navigate = useUI((state) => state.navigate);

  const diagnoses = analysis?.diagnoses ?? [];

  return (
    <Dialog
      open={instanceId !== null}
      onClose={close}
      width="lg"
      title={t`Игра вылетела${instance === undefined ? '' : ` — ${instance.name}`}`}
      description={
        analysis?.exitCode === null || analysis?.exitCode === undefined
          ? t`Разбираю логи и крашрепорт…`
          : t`Код выхода ${String(analysis.exitCode)}. Вот что удалось понять из логов и крашрепорта.`
      }
      busy={working !== null}
      footer={
        <>
          <Button
            variant="ghost"
            icon={<FileText size={14} strokeWidth={1.5} />}
            onClick={() => {
              if (instanceId !== null) navigate({ name: 'instance', id: instanceId, tab: 'logs' });
              close();
            }}
          >
            {t`Открыть логи`}</Button>
          <Button variant="ghost" onClick={close}>
            {t`Закрыть`}</Button>
          {applied.size > 0 && account !== null && instanceId !== null && (
            <Button
              variant="primary"
              icon={<Play size={14} strokeWidth={1.5} />}
              onClick={() => {
                void launch(instanceId, account.id);
                close();
              }}
            >
              {t`Запустить снова`}</Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-2 py-2">
        {loading ? (
          <>
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </>
        ) : diagnoses.length === 0 ? (
          <div className="flex flex-col gap-3">
            <div className="flex gap-3 rounded-lg border border-border p-3">
              <HelpCircle size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-text-dim" />
              <div>
                <p className="text-sm text-text">{t`Точную причину определить не удалось`}</p>
                <p className="mt-1 text-xs leading-relaxed text-text-dim">
                  {t`Чаще всего помогает: обновить моды («Моды» → «Проверить обновления»), выключить недавно добавленные моды, удалить шейдеры, обновить видеодрайвер.`}</p>
              </div>
            </div>
            {analysis !== null && analysis.excerpt.length > 0 && (
              <pre className="selectable max-h-48 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-2xs leading-relaxed text-text-dim">
                {analysis.excerpt.join('\n')}
              </pre>
            )}
          </div>
        ) : (
          diagnoses.map((diagnosis, index) => {
            const done = applied.has(index);
            return (
              <div key={`${diagnosis.rule}-${String(index)}`} className="flex gap-3 rounded-lg border border-border p-3">
                <Wrench size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text">{diagnosis.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-text-dim">{diagnosis.explanation}</p>
                  {diagnosis.fix !== null && (
                    <div className="mt-2.5">
                      <Button
                        size="sm"
                        variant={done ? 'secondary' : 'primary'}
                        disabled={done}
                        loading={working === index}
                        icon={done ? <Check size={13} strokeWidth={2} /> : undefined}
                        onClick={() => {
                          if (diagnosis.fix !== null) void apply(index, diagnosis.fix);
                        }}
                      >
                        {done ? t`Исправлено` : fixLabel(diagnosis.fix)}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Dialog>
  );
}
