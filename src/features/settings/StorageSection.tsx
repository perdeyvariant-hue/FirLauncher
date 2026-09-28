import { useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/Skeleton';
import * as metaApi from '@/api/meta';
import type { CleanupPlan, StorageUsage } from '@/api/meta';
import { artGradient, artIndexOf } from '@/lib/art';
import { formatBytes, initialsOf } from '@/lib/format';
import { Glyph, LETTERS, glyphOf } from '@/lib/glyphs';
import { isTauri } from '@/lib/ipc';
import { useAsyncData } from '@/lib/useAsyncData';
import { useInstances } from '@/store/useInstances';
import { useSettings } from '@/store/useSettings';
import { useToasts } from '@/store/useToasts';
import { t } from '@/lib/i18n';

interface Category {
  readonly name: string;
  readonly bytes: number;
  readonly color: string;
}

/**
 * Where the disk space goes — by kind in one bar, then by instance — and
 * taking back what no instance uses any more.
 */
export function StorageSection(): ReactElement {
  const usage = useAsyncData<StorageUsage>(() => metaApi.storageUsage(), []);
  const instances = useInstances((state) => state.instances);
  const override = useSettings((state) => state.settings.dataDirOverride);
  const patch = useSettings((state) => state.patch);
  const notify = useToasts((state) => state.notify);
  const fail = useToasts((state) => state.fail);

  const [open, setOpen] = useState(false);
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

  const chooseFolder = async (): Promise<void> => {
    if (!isTauri()) {
      notify(t`Выбор папки доступен только в приложении`);
      return;
    }
    try {
      const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
      const picked = await openDialog({ directory: true, multiple: false });
      if (typeof picked !== 'string') return;
      await patch({ dataDirOverride: picked });
      notify(t`Новая папка данных заработает после перезапуска лаунчера`, 'success');
    } catch (raw) {
      fail(raw);
    }
  };

  const data = usage.data;
  const instancesTotal = data?.instances.reduce((sum, item) => sum + item.bytes, 0) ?? 0;
  const categories: readonly Category[] =
    data === null
      ? []
      : [
          { name: t`Сборки`, bytes: instancesTotal, color: 'rgb(var(--accent-rgb))' },
          { name: t`Ассеты`, bytes: data.assets, color: 'rgb(var(--accent-2-rgb))' },
          { name: 'Java', bytes: data.java, color: 'rgb(var(--accent-3-rgb))' },
          {
            name: t`Библиотеки`,
            bytes: data.libraries,
            color: 'color-mix(in oklab, rgb(var(--accent-rgb)) 45%, #fff)',
          },
          {
            name: t`Версии игры`,
            bytes: data.versions,
            color: 'color-mix(in oklab, rgb(var(--accent-2-rgb)) 45%, #8a8a99)',
          },
        ];
  const largest = Math.max(1, ...(data?.instances ?? []).map((item) => item.bytes));
  const pendingFolder = override.trim() !== '' && data !== null && override.trim() !== data.root;

  return (
    <section className="glass rounded-xl p-[18px]">
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-text">{t`Хранилище`}</h2>
        {data !== null && (
          <span className="font-mono text-[12.5px] text-text">{formatBytes(data.total)}</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <p
          className="selectable min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-faint"
          title={data?.root}
        >
          {data?.root ?? '…'}
        </p>
        <Button
          size="sm"
          className="h-7 px-3 text-xs"
          onClick={() => {
            void chooseFolder();
          }}
        >
          {t`Изменить`}
        </Button>
      </div>
      {pendingFolder && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-text-dim">
          {t`После перезапуска:`} <span className="font-mono text-[11.5px]">{override}</span>
          <button
            type="button"
            className="text-accent hover:underline"
            onClick={() => {
              void patch({ dataDirOverride: '' });
            }}
          >
            {t`Отменить`}
          </button>
        </p>
      )}

      {data === null ? (
        <Skeleton className="mt-3.5 h-10" />
      ) : (
        <>
          <div className="mt-3.5 flex h-2.5 gap-[3px] overflow-hidden rounded-pill">
            {categories
              .filter((category) => category.bytes > 0)
              .map((category) => (
                <div
                  key={category.name}
                  title={`${category.name}: ${formatBytes(category.bytes)}`}
                  style={{ flexGrow: category.bytes, background: category.color }}
                />
              ))}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1.5">
            {categories.map((category) => (
              <div key={category.name} className="flex items-center gap-1.5 text-xs text-text-dim">
                <span className="h-2 w-2 rounded-[3px]" style={{ background: category.color }} />
                {category.name}
                <span className="text-text-faint">{formatBytes(category.bytes)}</span>
              </div>
            ))}
          </div>

          {data.instances.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => {
                  setOpen((value) => !value);
                }}
                aria-expanded={open}
                className="mt-3.5 flex items-center gap-1.5 text-[13px] font-medium text-text"
              >
                <ChevronRight
                  size={12}
                  strokeWidth={3}
                  className={cn('transition-transform duration-spring ease-spring', open && 'rotate-90')}
                />
                {t`По сборкам`}
              </button>
              {open && (
                <div className="mt-2.5 flex flex-col gap-2">
                  {data.instances.map((item, index) => {
                    const known = instances.find((instance) => instance.id === item.id);
                    return (
                      <div
                        key={item.id}
                        className="stagger flex items-center gap-2.5 text-[12.5px]"
                        style={{ '--i': index } as CSSProperties}
                      >
                        <span
                          className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] font-mono text-[8.5px] font-bold text-white"
                          style={{ background: artGradient(known?.color ?? artIndexOf(item.id)) }}
                        >
                          {known !== undefined && glyphOf(known) !== LETTERS ? (
                            <Glyph id={glyphOf(known)} size={12} strokeWidth={2.2} />
                          ) : (
                            initialsOf(item.name)
                          )}
                        </span>
                        <span className="w-[140px] truncate text-text">{item.name}</span>
                        <span className="h-[5px] flex-1 rounded-pill bg-[var(--track)]">
                          <span
                            className="block h-full rounded-pill bg-accent"
                            style={{ width: `${String((item.bytes / largest) * 100)}%` }}
                          />
                        </span>
                        <span className="w-[68px] text-right font-mono text-[11.5px] text-text-dim">
                          {formatBytes(item.bytes)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-3">
        <Button size="sm" loading={looking} onClick={look}>
          {t`Найти лишние файлы`}
        </Button>
        {plan !== null &&
          (plan.blocked !== null ? (
            <p className="text-xs text-danger">{plan.blocked}</p>
          ) : plan.files === 0 ? (
            <p className="text-xs text-text-dim">{t`Лишнего нет — всё нужно хотя бы одной сборке.`}</p>
          ) : (
            <>
              <p className="text-xs text-text-dim">
                {t`Можно освободить ${formatBytes(plan.bytes)} — файлов: ${String(plan.files)}`}
              </p>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  setConfirming(true);
                }}
              >
                {t`Удалить`}
              </Button>
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
    </section>
  );
}
