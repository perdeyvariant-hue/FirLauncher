import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Boxes, ChevronDown, SearchX } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Page } from '@/components/layout/PageHeader';
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
import type { InstanceView } from './FilterBar';
import { GroupDialog } from './GroupDialog';
import { InstanceCard, InstanceRow } from './InstanceCard';
import type { InstanceCardActions } from './InstanceCard';
import type { Instance } from '@/types/instance';
import { locale, plural, t } from '@/lib/i18n';

const COLLAPSED_KEY = 'firlauncher.collapsedGroups';
const VIEW_KEY = 'firlauncher.instanceView';

function readView(): InstanceView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

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
  const setFilters = useInstances((state) => state.setFilters);
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
  // The command palette asks for the dialog through the store.
  const createRequest = useUI((state) => state.createRequest);
  const seenRequest = useRef(createRequest);
  useEffect(() => {
    if (createRequest === seenRequest.current) return;
    seenRequest.current = createRequest;
    setCreateOpen(true);
  }, [createRequest]);
  const [importOpen, setImportOpen] = useState(false);
  const openExport = usePacks((state) => state.openExport);
  const navigate = useUI((state) => state.navigate);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<Instance | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsed);
  const [view, setView] = useState<InstanceView>(readView);
  const chooseView = (next: InstanceView): void => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // The choice still holds for this session.
    }
  };
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

  const actions: InstanceCardActions = {
    onOpen: openInstance,
    onPlay: handlePlay,
    onStop: (id) => {
      void instancesApi.killInstance(id).catch((raw: unknown) => fail(raw));
    },
    onOpenFolder: (id) => {
      void instancesApi.openInstanceFolder(id).catch((raw: unknown) => fail(raw));
    },
    onDuplicate: (id) => {
      void duplicate(id);
    },
    onExport: (id) => {
      const target = findInstance(id);
      if (target !== undefined) openExport(target);
    },
    onDelete: setPendingDelete,
    onToggleFavorite: (id) => {
      const target = findInstance(id);
      if (target !== undefined) void save({ ...target, favorite: !target.favorite });
    },
    onChooseGroup: (id) => {
      setGrouping(findInstance(id) ?? null);
    },
    onShortcut: (id) => {
      void createDesktopShortcut(id)
        .then(() => {
          notify(t`Ярлык создан на рабочем столе`, 'success');
        })
        .catch((raw: unknown) => fail(raw));
    },
  };

  const filtered = visible.length !== total;
  let position = 0;

  return (
    <Page
      title={t`Сборки`}
      subtitle={
        total === 0
          ? undefined
          : filtered
            ? t`${String(visible.length)} из ${String(total)}`
            : plural(total, ['сборка', 'сборки', 'сборок'], ['instance', 'instances'])
      }
    >
      <FilterBar
        view={view}
        onView={chooseView}
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

      {loading ? (
        <div className="mt-3.5 grid grid-cols-[repeat(auto-fill,minmax(212px,1fr))] gap-3.5">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-[228px]" />
          ))}
        </div>
      ) : total === 0 ? (
        <EmptyState
          icon={<Boxes />}
          title={t`Нет сборок`}
          description={t`Создайте первую сборку или установите готовый модпак с Modrinth и CurseForge.`}
          action={
            <>
              <Button
                variant="primary"
                onClick={() => {
                  setCreateOpen(true);
                }}
              >
                {t`Создать сборку`}
              </Button>
              <Button
                onClick={() => {
                  navigate({ name: 'modpacks' });
                }}
              >
                {t`Каталог модпаков`}
              </Button>
            </>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title={t`Ничего не найдено`}
          description={t`Попробуйте изменить поиск или сбросить фильтры.`}
          action={
            <Button
              onClick={() => {
                setFilters({ search: '', version: null, loader: null });
              }}
            >
              {t`Сбросить фильтры`}
            </Button>
          }
        />
      ) : (
        (sections ?? [{ key: '', title: '', items: visible }]).map((section) => {
          const folded = sections !== null && collapsed.has(section.key);
          return (
            <section key={section.key} className="mt-3.5">
              {sections !== null && (
                <button
                  type="button"
                  onClick={() => {
                    toggleSection(section.key);
                  }}
                  className="flex h-[34px] items-center gap-2 px-1 text-xs font-bold uppercase tracking-[0.06em] text-text-dim transition-colors duration-fast hover:text-text"
                >
                  <ChevronDown
                    size={11}
                    strokeWidth={3}
                    className={cn('transition-transform duration-spring ease-spring', folded && '-rotate-90')}
                  />
                  {section.title}
                  <span className="font-semibold opacity-60">{section.items.length}</span>
                </button>
              )}
              {!folded &&
                (view === 'grid' ? (
                  <div className="mt-1.5 grid grid-cols-[repeat(auto-fill,minmax(212px,1fr))] gap-3.5">
                    {section.items.map((instance) => (
                      <InstanceCard key={instance.id} instance={instance} index={position++} {...actions} />
                    ))}
                  </div>
                ) : (
                  <div className="glass mt-1.5 flex flex-col overflow-hidden rounded-xl">
                    {section.items.map((instance) => (
                      <InstanceRow key={instance.id} instance={instance} index={position++} {...actions} />
                    ))}
                  </div>
                ))}
            </section>
          );
        })
      )}

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
    </Page>
  );
}
