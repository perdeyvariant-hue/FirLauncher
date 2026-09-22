import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { ArrowDownToLine, Copy, Search, Share2, Stethoscope, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ErrorBlock } from '@/components/ui/ErrorBlock';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import * as instancesApi from '@/api/instances';
import { openExternal, shareLog } from '@/api/system';
import { onEvent } from '@/lib/events';
import { useAsyncData } from '@/lib/useAsyncData';
import type { Instance } from '@/types/instance';
import { useCrash } from '@/store/useCrash';
import { useToasts } from '@/store/useToasts';
import { t } from '@/lib/i18n';

type Severity = 'error' | 'warn' | 'info';

function severityOf(line: string): Severity {
  if (/\b(ERROR|FATAL|Exception|\tat )\b/.test(line)) return 'error';
  if (/\bWARN\b/.test(line)) return 'warn';
  return 'info';
}

type Level = 'all' | 'warn' | 'error';

const LEVELS: readonly { readonly value: Level; readonly label: string }[] = [
  { value: 'all', label: t`Всё` },
  { value: 'warn', label: t`Предупреждения` },
  { value: 'error', label: t`Ошибки` },
];

const SEVERITY_CLASS: Readonly<Record<Severity, string>> = {
  error: 'text-danger',
  warn: 'text-text',
  info: 'text-text-dim',
};

export function LogsTab({ instance }: { instance: Instance }): ReactElement {
  const { data, loading, error, reload } = useAsyncData<string[]>(
    () => instancesApi.readRecentLog(instance.id),
    [instance.id],
  );
  const notify = useToasts((state) => state.notify);

  const [live, setLive] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [level, setLevel] = useState<Level>('all');
  const [confirmShare, setConfirmShare] = useState(false);
  const [sharing, setSharing] = useState(false);
  const fail = useToasts((state) => state.fail);
  const openCrash = useCrash((state) => state.open);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Reset the live tail when switching instances.
  useEffect(() => {
    setLive([]);
  }, [instance.id]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void onEvent('game://log', (payload) => {
      if (payload.instanceId !== instance.id) return;
      setLive((current) => [...current, payload.line].slice(-5000));
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [instance.id]);

  const lines = useMemo(() => [...(data ?? []), ...live], [data, live]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return lines.filter((line) => {
      if (needle !== '' && !line.toLowerCase().includes(needle)) return false;
      if (level === 'all') return true;
      const severity = severityOf(line);
      return level === 'error' ? severity === 'error' : severity !== 'info';
    });
  }, [lines, filter, level]);

  const share = async (): Promise<void> => {
    setConfirmShare(false);
    setSharing(true);
    try {
      const url = await shareLog(lines);
      await navigator.clipboard.writeText(url).catch(() => undefined);
      notify(t`Ссылка скопирована: ${url}`, 'success');
      void openExternal(url);
    } catch (raw) {
      fail(raw);
    }
    setSharing(false);
  };

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [visible, autoScroll]);

  if (error !== null) return <ErrorBlock error={error} onRetry={reload} />;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="w-[240px]">
          <Input
            placeholder={t`Фильтр по строке`}
            value={filter}
            monospace
            onChange={(event) => {
              setFilter(event.target.value);
            }}
            leading={<Search size={14} strokeWidth={1.5} />}
          />
        </div>

        <div role="radiogroup" className="flex rounded-lg border border-border bg-surface-2 p-0.5">
          {LEVELS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={option.value === level}
              onClick={() => {
                setLevel(option.value);
              }}
              className={cn(
                'h-7 rounded-md px-2.5 text-2xs font-medium transition-colors duration-fast ease-out',
                option.value === level ? 'bg-accent text-on-accent' : 'text-text-dim hover:text-text',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <Switch checked={autoScroll} onChange={setAutoScroll} label={t`Автопрокрутка`} />

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            icon={<Stethoscope size={13} strokeWidth={1.5} />}
            onClick={() => {
              void openCrash(instance.id);
            }}
          >
            {t`Разобрать вылет`}</Button>
          <Button
            size="sm"
            loading={sharing}
            disabled={lines.length === 0}
            icon={<Share2 size={13} strokeWidth={1.5} />}
            onClick={() => {
              setConfirmShare(true);
            }}
          >
            {t`Поделиться`}</Button>
          <Button
            size="sm"
            icon={<Copy size={13} strokeWidth={1.5} />}
            onClick={() => {
              void navigator.clipboard
                .writeText(visible.join('\n'))
                .then(() => {
                  notify(t`Лог скопирован`, 'success');
                })
                .catch(() => {
                  notify(t`Не удалось скопировать лог`, 'error');
                });
            }}
          >
            {t`Копировать`}</Button>
          <Button
            size="sm"
            icon={<Trash2 size={13} strokeWidth={1.5} />}
            onClick={() => {
              setLive([]);
            }}
          >
            {t`Очистить`}</Button>
          {!autoScroll && (
            <Button
              size="sm"
              icon={<ArrowDownToLine size={13} strokeWidth={1.5} />}
              onClick={() => {
                bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
              }}
            >
              {t`Вниз`}</Button>
          )}
        </div>
      </div>

      <div className="panel min-h-0 flex-1 overflow-auto bg-surface p-3">
        {loading ? (
          <p className="font-mono text-xs text-text-dim">{t`Чтение журнала…`}</p>
        ) : visible.length === 0 ? (
          <p className="font-mono text-xs text-text-dim">
            {lines.length === 0 ? t`Журнал пуст — сборка ещё не запускалась.` : t`Ничего не найдено.`}
          </p>
        ) : (
          <pre className="selectable whitespace-pre-wrap font-mono text-2xs leading-[1.65]">
            {visible.map((line, index) => (
              <span key={`${String(index)}-${line.slice(0, 24)}`} className={cn('block', SEVERITY_CLASS[severityOf(line)])}>
                {line}
              </span>
            ))}
          </pre>
        )}
        <div ref={bottomRef} />
      </div>

      <ConfirmDialog
        open={confirmShare}
        title={t`Опубликовать журнал на mclo.gs?`}
        description={t`Журнал станет доступен по ссылке всем, у кого она есть, — так его удобно показать в Discord или на форуме. Путь к вашей папке пользователя и токены лаунчер удалит, IP-адреса удаляет сам mclo.gs. Игровой ник останется.`}
        confirmLabel={t`Опубликовать`}
        onCancel={() => {
          setConfirmShare(false);
        }}
        onConfirm={() => {
          void share();
        }}
      />
    </div>
  );
}
