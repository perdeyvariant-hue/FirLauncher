import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Archive, Package } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import * as packsApi from '@/api/packs';
import { formatBytes } from '@/lib/format';
import { isTauri } from '@/lib/ipc';
import type { ExportFormat } from '@/types/pack';
import { usePacks } from '@/store/usePacks';
import { useToasts } from '@/store/useToasts';

const FORMATS: readonly {
  readonly value: ExportFormat;
  readonly title: string;
  readonly text: string;
  readonly icon: ReactElement;
}[] = [
  {
    value: 'mrpack',
    title: 'Модпак Modrinth (.mrpack)',
    text: 'Лёгкий файл: моды с Modrinth идут ссылками, остальное и настройки — внутри. Миры не входят.',
    icon: <Package size={16} strokeWidth={1.5} />,
  },
  {
    value: 'zip',
    title: 'Полная копия (.zip)',
    text: 'Всё содержимое сборки, включая миры и скриншоты. Открывается импортом в FirLauncher.',
    icon: <Archive size={16} strokeWidth={1.5} />,
  },
];

/** Safe file name from an instance name: no path separators or reserved characters. */
function fileNameFor(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*]/g, '').trim();
  return cleaned === '' ? 'instance' : cleaned;
}

export function ExportDialog(): ReactElement {
  const target = usePacks((state) => state.exportTarget);
  const close = usePacks((state) => state.closeExport);
  const notify = useToasts((state) => state.notify);
  const fail = useToasts((state) => state.fail);

  const [format, setFormat] = useState<ExportFormat>('mrpack');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target !== null) setFormat('mrpack');
  }, [target]);

  const run = async (): Promise<void> => {
    if (target === null) return;
    if (!isTauri()) {
      notify('Экспорт доступен только в приложении');
      return;
    }
    const extension = format === 'mrpack' ? '.mrpack' : '.zip';
    const destination = await packsApi.pickExportPath(`${fileNameFor(target.name)}${extension}`, format);
    if (destination === null) return;

    setBusy(true);
    try {
      const summary = await packsApi.exportInstance(target.id, format, destination);
      notify(
        format === 'mrpack'
          ? `Готово: ${String(summary.linked)} файлов ссылками, ${String(summary.embedded)} внутри, ${formatBytes(summary.bytes)}`
          : `Готово: ${formatBytes(summary.bytes)}`,
        'success',
      );
      close();
    } catch (raw) {
      fail(raw);
    }
    setBusy(false);
  };

  return (
    <Dialog
      open={target !== null}
      onClose={close}
      title={target === null ? '' : `Экспорт «${target.name}»`}
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={busy}>
            Отмена
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={() => {
              void run();
            }}
          >
            Выбрать место и сохранить
          </Button>
        </>
      }
    >
      <div role="radiogroup" className="flex flex-col gap-2 py-2">
        {FORMATS.map((option) => {
          const selected = option.value === format;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                setFormat(option.value);
              }}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors duration-fast ease-out',
                selected ? 'border-accent bg-accent/5' : 'border-border hover:border-text-dim/35',
              )}
            >
              <span className={cn('mt-0.5 shrink-0', selected ? 'text-accent' : 'text-text-dim')}>
                {option.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium text-text">{option.title}</span>
                <span className="mt-1 block text-2xs leading-relaxed text-text-dim">{option.text}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
