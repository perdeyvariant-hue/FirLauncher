import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { ArrowDownToLine, Copy, Search, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { ErrorBlock } from '@/components/ui/ErrorBlock';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import * as instancesApi from '@/api/instances';
import { onEvent } from '@/lib/events';
import { useAsyncData } from '@/lib/useAsyncData';
import type { Instance } from '@/types/instance';
import { useToasts } from '@/store/useToasts';

type Severity = 'error' | 'warn' | 'info';

function severityOf(line: string): Severity {
  if (/\b(ERROR|FATAL|Exception|\tat )\b/.test(line)) return 'error';
  if (/\bWARN\b/.test(line)) return 'warn';
  return 'info';
}

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
    if (needle === '') return lines;
    return lines.filter((line) => line.toLowerCase().includes(needle));
  }, [lines, filter]);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [visible, autoScroll]);

  if (error !== null) return <ErrorBlock error={error} onRetry={reload} />;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="w-[240px]">
          <Input
            placeholder="Фильтр по строке"
            value={filter}
            monospace
            onChange={(event) => {
              setFilter(event.target.value);
            }}
            leading={<Search size={14} strokeWidth={1.5} />}
          />
        </div>

        <Switch checked={autoScroll} onChange={setAutoScroll} label="Автопрокрутка" />

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            icon={<Copy size={13} strokeWidth={1.5} />}
            onClick={() => {
              void navigator.clipboard
                .writeText(visible.join('\n'))
                .then(() => {
                  notify('Лог скопирован', 'success');
                })
                .catch(() => {
                  notify('Не удалось скопировать лог', 'error');
                });
            }}
          >
            Копировать
          </Button>
          <Button
            size="sm"
            icon={<Trash2 size={13} strokeWidth={1.5} />}
            onClick={() => {
              setLive([]);
            }}
          >
            Очистить
          </Button>
          {!autoScroll && (
            <Button
              size="sm"
              icon={<ArrowDownToLine size={13} strokeWidth={1.5} />}
              onClick={() => {
                bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
              }}
            >
              Вниз
            </Button>
          )}
        </div>
      </div>

      <div className="panel min-h-0 flex-1 overflow-auto bg-surface p-3">
        {loading ? (
          <p className="font-mono text-xs text-text-dim">Чтение журнала…</p>
        ) : visible.length === 0 ? (
          <p className="font-mono text-xs text-text-dim">
            {lines.length === 0 ? 'Журнал пуст — сборка ещё не запускалась.' : 'Ничего не найдено.'}
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
    </div>
  );
}
