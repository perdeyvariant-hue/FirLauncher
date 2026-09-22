import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { ArrowLeft, History, PackageSearch, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBlock } from '@/components/ui/ErrorBlock';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { SelectOption } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import * as modsApi from '@/api/mods';
import type { ContentKind } from '@/api/mods';
import { openExternal } from '@/api/system';
import { toLauncherError } from '@/lib/ipc';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import type { LauncherError } from '@/types/error';
import type { Instance } from '@/types/instance';
import { LOADER_LABELS } from '@/types/instance';
import type { Category, ModProject, ProviderId, SearchQuery } from '@/types/mod';
import { PROVIDER_LABELS } from '@/types/mod';
import { useToasts } from '@/store/useToasts';
import { ModCard } from './ModCard';
import type { InstallState } from './ModCard';
import { ProjectDialog } from './ProjectDialog';
import type { ProjectTarget } from './ProjectDialog';
import { useContentInstaller } from './useContentInstaller';
import { t } from '@/lib/i18n';

const PAGE = 20;
const ANY = '__any__';

type Sort = SearchQuery['sort'];
const SORT_OPTIONS: SelectOption<Sort>[] = [
  { value: 'relevance', label: t`По релевантности` },
  { value: 'downloads', label: t`По загрузкам` },
  { value: 'follows', label: t`По популярности` },
  { value: 'updated', label: t`Недавно обновлённые` },
  { value: 'newest', label: t`Новые` },
];

/** Per-kind wording; the browser itself is the same for all three. */
const COPY: Readonly<
  Record<ContentKind, { title: string; back: string; nothing: string }>
> = {
  mod: {
    title: t`Добавить моды`,
    back: t`К установленным модам`,
    nothing: t`модов`,
  },
  resourcepack: {
    title: t`Добавить ресурспаки`,
    back: t`К установленным ресурспакам`,
    nothing: t`ресурспаков`,
  },
  shader: {
    title: t`Добавить шейдеры`,
    back: t`К установленным шейдерам`,
    nothing: t`шейдеров`,
  },
};

export interface ContentBrowserProps {
  instance: Instance;
  kind: ContentKind;
  onBack: () => void;
  /** Called after anything was installed, so the list can refresh. */
  onInstalled: () => void;
}

export function ContentBrowser({
  instance,
  kind,
  onBack,
  onInstalled,
}: ContentBrowserProps): ReactElement {
  const copy = COPY[kind];
  const fail = useToasts((store) => store.fail);

  const [providers, setProviders] = useState<ProviderId[]>(['modrinth']);
  const [provider, setProvider] = useState<ProviderId>('modrinth');
  const [text, setText] = useState('');
  const query = useDebouncedValue(text.trim(), 350);
  const [category, setCategory] = useState<string>(ANY);
  const [categories, setCategories] = useState<Category[]>([]);
  const [sort, setSort] = useState<Sort>('relevance');
  // Bumped by "retry" to re-run the same search.
  const [attempt, setAttempt] = useState(0);

  const [hits, setHits] = useState<ModProject[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<LauncherError | null>(null);

  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState<Set<string>>(new Set());

  const installer = useContentInstaller(instance, kind, (plan) => {
    setInstalled((current) => {
      const next = new Set(current);
      next.add(plan.primary.projectId);
      for (const dependency of plan.dependencies) next.add(dependency.projectId);
      return next;
    });
    onInstalled();
  });

  // Only the newest search may write results; slower old ones are dropped.
  const requestId = useRef(0);

  useEffect(() => {
    void modsApi
      .availableProviders()
      .then(setProviders)
      .catch((raw: unknown) => fail(raw));
  }, [fail]);

  useEffect(() => {
    setCategory(ANY);
    void modsApi
      .listCategories(provider, kind)
      .then(setCategories)
      .catch(() => {
        setCategories([]);
      });
    void modsApi
      .installedProjects(instance.id, provider, kind)
      .then((ids) => {
        setInstalled(new Set(ids));
      })
      .catch(() => {
        setInstalled(new Set());
      });
  }, [provider, instance.id, kind]);

  const buildQuery = useCallback(
    (offset: number): SearchQuery => ({
      provider,
      text: query,
      kind,
      gameVersion: instance.mcVersion,
      // Only mods are filtered by loader; the backend ignores it for packs.
      loader: kind === 'mod' ? instance.loader : null,
      categories: category === ANY ? [] : [category],
      sort,
      offset,
      limit: PAGE,
    }),
    [provider, query, kind, instance.mcVersion, instance.loader, category, sort],
  );

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    modsApi
      .searchProjects(buildQuery(0))
      .then((result) => {
        if (id !== requestId.current) return;
        setHits([...result.hits]);
        setTotal(result.totalHits);
      })
      .catch((raw: unknown) => {
        if (id === requestId.current) setError(toLauncherError(raw));
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }, [buildQuery, attempt]);

  const loadMore = (): void => {
    const id = requestId.current;
    setLoadingMore(true);
    modsApi
      .searchProjects(buildQuery(hits.length))
      .then((result) => {
        if (id !== requestId.current) return;
        // Guard against a project shifting between pages.
        setHits((current) => {
          const seen = new Set(current.map((hit) => hit.projectId));
          return [...current, ...result.hits.filter((hit) => !seen.has(hit.projectId))];
        });
      })
      .catch((raw: unknown) => fail(raw))
      .finally(() => {
        setLoadingMore(false);
      });
  };

  const setWorkingFor = (projectId: string, on: boolean): void => {
    setWorking((current) => {
      const next = new Set(current);
      if (on) next.add(projectId);
      else next.delete(projectId);
      return next;
    });
  };

  const [described, setDescribed] = useState<ProjectTarget | null>(null);

  const chooseVersion = (project: ModProject): void => {
    installer.chooseVersion({
      provider: project.provider,
      projectId: project.projectId,
      name: project.name,
      currentVersionId: null,
    });
  };

  const install = async (project: ModProject): Promise<void> => {
    setWorkingFor(project.projectId, true);
    await installer.install(project.provider, project.projectId);
    setWorkingFor(project.projectId, false);
  };

  const stateOf = (project: ModProject): InstallState => {
    if (installed.has(project.projectId)) return 'installed';
    if (working.has(project.projectId)) return 'working';
    return 'idle';
  };

  const categoryOptions = useMemo<SelectOption<string>[]>(
    () => [
      { value: ANY, label: t`Все категории` },
      ...categories.map((item) => ({ value: item.id, label: item.name })),
    ],
    [categories],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <IconButton label={copy.back} icon={<ArrowLeft size={16} strokeWidth={1.5} />} onClick={onBack} />
        <h2 className="text-sm font-semibold text-text">{copy.title}</h2>
        <Badge tone="outline">{instance.mcVersion}</Badge>
        {kind === 'mod' && <Badge tone="neutral">{LOADER_LABELS[instance.loader]}</Badge>}

        {providers.length > 1 && (
          <div role="tablist" className="ml-auto flex rounded-lg border border-border bg-surface-2 p-0.5">
            {providers.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={id === provider}
                onClick={() => {
                  setProvider(id);
                }}
                className={cn(
                  'h-7 rounded-md px-3 text-xs font-medium transition-colors duration-fast ease-out',
                  id === provider ? 'bg-accent text-on-accent' : 'text-text-dim hover:text-text',
                )}
              >
                {PROVIDER_LABELS[id]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input
            placeholder={t`Поиск на ${PROVIDER_LABELS[provider]}`}
            value={text}
            autoFocus
            onChange={(event) => {
              setText(event.target.value);
            }}
            leading={<Search size={14} strokeWidth={1.5} />}
          />
        </div>
        <Select compact className="w-[190px]" value={category} options={categoryOptions} onChange={setCategory} />
        <Select compact className="w-[200px]" value={sort} options={SORT_OPTIONS} onChange={setSort} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {error !== null ? (
          <ErrorBlock
            error={error}
            onRetry={() => {
              setAttempt((value) => value + 1);
            }}
          />
        ) : loading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-2">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-[104px]" />
            ))}
          </div>
        ) : hits.length === 0 ? (
          <EmptyState
            compact
            icon={<PackageSearch size={20} strokeWidth={1.5} />}
            title={t`Ничего не найдено`}
            description={
              kind === 'mod'
                ? t`Под Minecraft ${instance.mcVersion} с ${LOADER_LABELS[instance.loader]} таких модов нет. Попробуйте другой запрос или категорию.`
                : t`Под Minecraft ${instance.mcVersion} таких ${copy.nothing} нет. Попробуйте другой запрос или категорию.`
            }
          />
        ) : (
          <div className="flex flex-col gap-3 pb-2">
            <p className="text-2xs text-text-dim">{t`Найдено: `}{total}</p>
            <div className="grid animate-fade-in grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-2">
              {hits.map((project) => (
                <ModCard
                  key={project.projectId}
                  project={project}
                  state={stateOf(project)}
                  onInstall={() => {
                    void install(project);
                  }}
                  onOpen={() => {
                    setDescribed({
                      provider: project.provider,
                      projectId: project.projectId,
                      preview: project,
                    });
                  }}
                  onVersions={() => {
                    chooseVersion(project);
                  }}
                  onOpenPage={
                    project.pageUrl === null
                      ? null
                      : () => {
                          void openExternal(project.pageUrl ?? '');
                        }
                  }
                />
              ))}
            </div>
            {hits.length < total && (
              <div className="flex justify-center">
                <Button size="sm" loading={loadingMore} onClick={loadMore}>
                  {t`Показать ещё`}</Button>
              </div>
            )}
          </div>
        )}
      </div>

      <ProjectDialog
        target={described}
        onClose={() => {
          setDescribed(null);
        }}
        actions={() => {
          const project = described?.preview;
          if (project === null || project === undefined) return null;
          const state = stateOf(project);
          return (
            <>
              <Button
                icon={<History size={14} strokeWidth={1.5} />}
                disabled={state === 'working'}
                onClick={() => {
                  setDescribed(null);
                  chooseVersion(project);
                }}
              >
                {t`Выбрать версию`}</Button>
              <Button
                variant="primary"
                loading={state === 'working'}
                disabled={state === 'installed'}
                onClick={() => {
                  void install(project);
                }}
              >
                {state === 'installed' ? t`Установлен` : t`Установить`}
              </Button>
            </>
          );
        }}
      />

      {installer.dialogs}
    </div>
  );
}
