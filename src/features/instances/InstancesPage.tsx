import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Boxes, ChevronDown, Plus, SearchX } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import * as instancesApi from '@/api/instances';
import { createDesktopShortcut } from '@/api/shortcuts';
import { activeAccountOf, useAccounts } from '@/store/useAccounts';
import { filterInstances, useInstances } from '@/store/useInstances';
import { useToasts } from '@/store/useToasts';
import { useUI } from '@/store/useUI';
import { ImportDialog } from '@/features/packs/ImportDialog';
import { usePacks } from '@/store/usePacks';
import { CreateInstanceDialog } from './CreateInstanceDialog';
import { FilterBar } from './FilterBar';
import { GroupDialog } from './GroupDialog';
import { InstanceCard } from './InstanceCard';
import type { Instance } from '@/types/instance';
import { locale, t } from '@/lib/i18n';

const COLLAPSED_KEY = 'firlauncher.collapsedGroups';

function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeCollapsed(value: ReadonlySet<string>): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...value]));
  } catch {
    // Collapsing still works for this session.
  }
}

interface Section {
  readonly key: string;
  readonly title: string;
  readonly items: readonly Instance[];
}

const FAVORITES = '__favorites__';
const UNGROUPED = '__ungrouped__';

/** Favorites first, then groups by name, then the rest. Flat when unused. */
function sectionsOf(instances: readonly Instance[]): Section[] | null {
  const favorites = instances.filter((instance) => instance.favorite);
  const grouped = new Map<string, Instance[]>();
  const rest: Instance[] = [];
  for (const instance of instances) {
    if (instance.favorite) continue;
    const group = instance.group?.trim() ?? '';
    if (group === '') rest.push(instance);
    else grouped.set(group, [...(grouped.get(group) ?? []), instance]);
  }
  if (favorites.length === 0 && grouped.size === 0) return null;
  const sections: Section[] = [];
  if (favorites.length > 0) sections.push({ key: FAVORITES, title: t`Избранное`, items: favorites });
  for (const name of [...grouped.keys()].sort((a, b) => a.localeCompare(b, locale))) {
    sections.push({ key: name, title: name, items: grouped.get(name) ?? [] });
  }
  if (rest.length > 0) sections.push({ key: UNGROUPED, title: t`Без группы`, items: rest });
  return sections;
}

export function InstancesPage(): ReactElement {
  const loading = useInstances((state) => state.loading);
  const instances = useInstances((state) => state.instances);
  const filters = useInstances((state) => state.filters);
  const visible = useMemo(() => filterInstances(instances, filters), [instances, filters]);
  const total = instances.length;
  const remove = useInstances((state) => state.remove);
  const duplicate = useInstances((state) => state.duplicate);
  const launch = useInstances((state) => state.launch);
  const openInstance = useUI((state) => state.openInstance);
  const account = useAccounts(activeAccountOf);
  const notify = useToasts((state) => state.notify);
  const fail = useToasts((state) => state.fail);

  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const openExport = usePacks((state) => state.openExport);
  const navigate = useUI((state) => state.navigate);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<Instance | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);
  const save = useInstances((state) => state.save);

  const groups = useMemo(
    () =>
      [...new Set(instances.map((instance) => instance.group?.trim() ?? '').filter((g) => g !== ''))].sort(
        (a, b) => a.localeCompare(b, locale),
      ),
    [instances],
  );
  const sections = useMemo(() => sectionsOf(visible), [visible]);

  const toggleSection = (key: string): void => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeCollapsed(next);
      return next;
    });
  };

  const findInstance = (id: string): Instance | undefined => instances.find((item) => item.id === id);

  const deleteTarget = instances.find((instance) => instance.id === pendingDelete) ?? null;

  const handlePlay = (id: string): void => {
    if (account === null) {
      notify(t`Сначала добавьте аккаунт`, 'error');
      return;
    }
    void launch(id, account.id);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="hairline-b flex h-14 shrink-0 items-center px-6">
        <h1 className="text-sm font-semibold text-text">{t`Сборки`}</h1>
        {total > 0 && (
          <span className="ml-2 text-xs text-text-dim">
            {visible.length === total
              ? total
              : t`${String(visible.length)} из ${String(total)}`}
          </span>
        )}
      </header>

      <FilterBar
        onCreate={() => {
          setCreateOpen(true);
        }}
        onImport={() => {
          setImportOpen(true);
        }}
        onModpacks={() => {
          navigate({ name: 'modpacks' });
        }}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {loading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-[104px]" />
            ))}
          </div>
        ) : total === 0 ? (
          <EmptyState
            icon={<Boxes size={20} strokeWidth={1.5} />}
            title={t`Пока нет ни одной сборки`}
            description={t`Создайте новую или импортируйте готовую — .mrpack, архив CurseForge либо инстанс MultiMC.`}
            action={
              <Button
                variant="primary"
                icon={<Plus size={15} strokeWidth={1.5} />}
                onClick={() => {
                  setCreateOpen(true);
                }}
              >
                {t`Создать сборку`}</Button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<SearchX size={20} strokeWidth={1.5} />}
            title={t`Ничего не найдено`}
            description={t`Измените поисковый запрос или сбросьте фильтры.`}
          />
        ) : (
          <div className="flex flex-col gap-5">
            {(sections ?? [{ key: '', title: '', items: visible }]).map((section) => {
              const folded = sections !== null && collapsed.has(section.key);
              return (
                <section key={section.key} className="flex flex-col gap-2.5">
                  {sections !== null && (
                    <button
                      type="button"
                      onClick={() => {
                        toggleSection(section.key);
                      }}
                      className="flex w-fit items-center gap-1.5 text-xs font-semibold text-text-dim transition-colors duration-fast ease-out hover:text-text"
                    >
                      <ChevronDown
                        size={14}
                        strokeWidth={1.75}
                        className={cn('transition-transform duration-fast ease-out', folded && '-rotate-90')}
                      />
                      {section.title}
                      <span className="font-normal">{section.items.length}</span>
                    </button>
                  )}
                  {!folded && (
                    <div className="grid animate-fade-in grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
                      {section.items.map((instance) => (
            <InstanceCard
              key={instance.id}
              instance={instance}
              onOpen={openInstance}
              onPlay={handlePlay}
              onStop={(id) => {
                void instancesApi.killInstance(id).catch((raw: unknown) => fail(raw));
              }}
              onOpenFolder={(id) => {
                void instancesApi.openInstanceFolder(id).catch((raw: unknown) => fail(raw));
              }}
              onDuplicate={(id) => {
                void duplicate(id);
              }}
              onExport={(id) => {
                const target = instances.find((item) => item.id === id);
                if (target !== undefined) openExport(target);
              }}
              onDelete={setPendingDelete}
              onToggleFavorite={(id) => {
                const target = findInstance(id);
                if (target !== undefined) void save({ ...target, favorite: !target.favorite });
              }}
              onChooseGroup={(id) => {
                setGrouping(findInstance(id) ?? null);
              }}
              onShortcut={(id) => {
                void createDesktopShortcut(id)
                  .then(() => {
                    notify(t`Ярлык создан на рабочем столе`, 'success');
                  })
                  .catch((raw: unknown) => fail(raw));
              }}
            />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      <GroupDialog
        instance={grouping}
        groups={groups}
        onClose={() => {
          setGrouping(null);
        }}
        onSave={(group) => {
          if (grouping !== null) void save({ ...grouping, group });
          setGrouping(null);
        }}
      />

      <ImportDialog
        open={importOpen}
        onClose={() => {
          setImportOpen(false);
        }}
      />

      <CreateInstanceDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        destructive
        title={t`Удалить «${deleteTarget?.name ?? ''}»?`}
        description={t`Папка сборки вместе с мирами, модами и настройками будет удалена безвозвратно.`}
        confirmLabel={t`Удалить`}
        onCancel={() => {
          setPendingDelete(null);
        }}
        onConfirm={() => {
          if (pendingDelete !== null) void remove(pendingDelete);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
