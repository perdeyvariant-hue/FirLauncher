import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Boxes,
  FolderOpen,
  Package,
  Palette,
  Play,
  Plus,
  Search,
  Settings as SettingsIcon,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import * as instancesApi from '@/api/instances';
import { activeAccountOf, useAccounts } from '@/store/useAccounts';
import { useInstances } from '@/store/useInstances';
import { useToasts } from '@/store/useToasts';
import { useUI } from '@/store/useUI';
import { t } from '@/lib/i18n';

interface Command {
  readonly id: string;
  readonly label: string;
  /** Shown dim on the right: where the command belongs. */
  readonly hint: string;
  readonly icon: ReactNode;
  /** Extra words the command answers to, beyond its label. */
  readonly keywords?: string;
  readonly run: () => void;
}

/**
 * Starts-with beats contains, the label beats the keywords: typing "fab"
 * should put "Fabric Perf" above something that merely mentions Fabric.
 */
function score(command: Command, needle: string): number {
  if (needle === '') return 1;
  const label = command.label.toLowerCase();
  if (label.startsWith(needle)) return 4;
  if (label.split(/\s+/).some((word) => word.startsWith(needle))) return 3;
  if (label.includes(needle)) return 2;
  if ((command.keywords ?? '').toLowerCase().includes(needle)) return 1;
  return 0;
}

/** Everything the launcher can do, reachable by typing. Ctrl+K opens it. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement | null {
  const instances = useInstances((state) => state.instances);
  const launch = useInstances((state) => state.launch);
  const navigate = useUI((state) => state.navigate);
  const openInstance = useUI((state) => state.openInstance);
  const requestCreate = useUI((state) => state.requestCreate);
  const fail = useToasts((state) => state.fail);
  const notify = useToasts((state) => state.notify);

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    // After the portal mounts.
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const pages: Command[] = [
      { id: 'go-instances', label: t`Сборки`, hint: t`Раздел`, icon: <Boxes size={15} strokeWidth={1.5} />, run: () => {
        navigate({ name: 'instances' });
      } },
      { id: 'go-modpacks', label: t`Модпаки`, hint: t`Раздел`, icon: <Package size={15} strokeWidth={1.5} />, keywords: 'modpack каталог', run: () => {
        navigate({ name: 'modpacks' });
      } },
      { id: 'go-accounts', label: t`Аккаунты`, hint: t`Раздел`, icon: <Users size={15} strokeWidth={1.5} />, keywords: 'microsoft вход', run: () => {
        navigate({ name: 'accounts' });
      } },
      { id: 'go-style', label: t`Стиль`, hint: t`Раздел`, icon: <Palette size={15} strokeWidth={1.5} />, keywords: 'оформление тема обои цвет', run: () => {
        navigate({ name: 'appearance' });
      } },
      { id: 'go-settings', label: t`Настройки`, hint: t`Раздел`, icon: <SettingsIcon size={15} strokeWidth={1.5} />, keywords: 'java память', run: () => {
        navigate({ name: 'settings' });
      } },
      { id: 'create', label: t`Создать сборку`, hint: t`Действие`, icon: <Plus size={15} strokeWidth={1.5} />, keywords: 'новая', run: requestCreate },
    ];

    const perInstance = instances.flatMap<Command>((instance) => [
      {
        id: `play-${instance.id}`,
        label: t`Играть: ${instance.name}`,
        hint: instance.mcVersion,
        icon: <Play size={15} strokeWidth={1.5} />,
        keywords: `${instance.name} запустить ${instance.loader}`,
        run: () => {
          const account = activeAccountOf(useAccounts.getState());
          if (account === null) {
            notify(t`Сначала добавьте аккаунт`, 'error');
            return;
          }
          void launch(instance.id, account.id);
        },
      },
      {
        id: `open-${instance.id}`,
        label: instance.name,
        hint: t`Сборка`,
        icon: <Boxes size={15} strokeWidth={1.5} />,
        keywords: `${instance.mcVersion} ${instance.loader}`,
        run: () => {
          openInstance(instance.id);
        },
      },
      {
        id: `mods-${instance.id}`,
        label: t`Моды: ${instance.name}`,
        hint: t`Сборка`,
        icon: <Package size={15} strokeWidth={1.5} />,
        run: () => {
          openInstance(instance.id, 'mods');
        },
      },
      {
        id: `folder-${instance.id}`,
        label: t`Папка: ${instance.name}`,
        hint: t`Сборка`,
        icon: <FolderOpen size={15} strokeWidth={1.5} />,
        run: () => {
          void instancesApi.openInstanceFolder(instance.id).catch((raw: unknown) => fail(raw));
        },
      },
    ]);

    return [...pages, ...perInstance];
  }, [instances, launch, navigate, openInstance, requestCreate, fail, notify]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return commands
      .map((command, order) => ({ command, rank: score(command, needle), order }))
      .filter((entry) => entry.rank > 0)
      // Equal ranks keep their natural order: sections before instances.
      .sort((a, b) => b.rank - a.rank || a.order - b.order)
      .slice(0, 40)
      .map((entry) => entry.command);
  }, [commands, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const runAt = (index: number): void => {
    const command = results[index];
    if (command === undefined) return;
    onClose();
    command.run();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center px-6 pt-[14vh]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 animate-fade-in bg-[var(--overlay)] backdrop-blur-[6px]" />
      <div
        role="dialog"
        aria-label={t`Быстрые действия`}
        className="glass-sheet relative flex w-full max-w-[560px] animate-glass-in flex-col overflow-hidden rounded-2xl"
      >
        <div className="hairline-b flex items-center gap-3 px-4">
          <Search size={16} strokeWidth={1.5} className="shrink-0 text-text-dim" />
          <input
            ref={inputRef}
            value={query}
            placeholder={t`Сборка, раздел или действие…`}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((value) => Math.min(results.length - 1, value + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((value) => Math.max(0, value - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                runAt(active);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              }
            }}
            className="h-12 min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-dim/70"
          />
          <kbd className="rounded-md bg-[rgb(var(--text-rgb)/0.08)] px-1.5 py-0.5 font-mono text-2xs text-text-dim">Esc</kbd>
        </div>

        <div ref={listRef} role="listbox" className="max-h-[360px] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-text-dim">{t`Ничего не нашлось`}</p>
          ) : (
            results.map((command, index) => (
              <button
                key={command.id}
                type="button"
                role="option"
                aria-selected={index === active}
                data-active={index === active}
                onMouseEnter={() => {
                  setActive(index);
                }}
                onClick={() => {
                  runAt(index);
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm',
                  index === active ? 'bg-[rgb(var(--text-rgb)/0.09)] text-text' : 'text-text',
                )}
              >
                <span className={cn('shrink-0', index === active ? 'text-accent' : 'text-text-dim')}>
                  {command.icon}
                </span>
                <span className="min-w-0 flex-1 truncate">{command.label}</span>
                <span className="shrink-0 text-2xs text-text-dim">{command.hint}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
