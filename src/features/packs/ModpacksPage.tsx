import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { ArrowLeft, PackageSearch, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBlock } from '@/components/ui/ErrorBlock';
import { Input } from '@/components/ui/Input';
import { Segmented } from '@/components/ui/Segmented';
import { Select } from '@/components/ui/Select';
import type { SelectOption } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import * as metaApi from '@/api/meta';
import * as modsApi from '@/api/mods';
import * as packsApi from '@/api/packs';
import { openExternal } from '@/api/system';
import { ModCard } from '@/features/mods/ModCard';
import { ProjectDialog } from '@/features/mods/ProjectDialog';
import type { ProjectTarget } from '@/features/mods/ProjectDialog';
import { toLauncherError } from '@/lib/ipc';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import type { LauncherError } from '@/types/error';
import type { Category, ModProject, ProviderId, SearchQuery } from '@/types/mod';
import { PROVIDER_LABELS } from '@/types/mod';
import { usePacks } from '@/store/usePacks';
import { useToasts } from '@/store/useToasts';
import { useUI } from '@/store/useUI';
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

/** Search and one-click install of modpacks, each becoming a new instance. */
export function ModpacksPage(): ReactElement {
  const back = useUI((state) => state.back);
  const finishImport = usePacks((state) => state.finishImport);
  const fail = useToasts((state) => state.fail);

  const [providers, setProviders] = useState<ProviderId[]>(['modrinth']);
  const [described, setDescribed] = useState<ProjectTarget | null>(null);
  const [provider, setProvider] = useState<ProviderId>('modrinth');
  const [text, setText] = useState('');
  const query = useDebouncedValue(text.trim(), 350);
  const [category, setCategory] = useState(ANY);
  const [categories, setCategories] = useState<Category[]>([]);
  const [version, setVersion] = useState(ANY);
  const [versions, setVersions] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>('relevance');
  const [attempt, setAttempt] = useState(0);

  const [hits, setHits] = useState<ModProject[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<LauncherError | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    void modsApi.availableProviders().then(setProviders).catch((raw: unknown) => fail(raw));
    void metaApi
      .listMinecraftVersions()
      .then((list) => {
        setVersions(list.filter((item) => item.type === 'release').map((item) => item.id));
      })
      .catch(() => {
        setVersions([]);
      });
  }, [fail]);

  useEffect(() => {
    setCategory(ANY);
    void modsApi
      .listCategories(provider, 'modpack')
      .then(setCategories)
      .catch(() => {
        setCategories([]);
      });
  }, [provider]);

  const buildQuery = useCallback(
    (offset: number): SearchQuery => ({
      provider,
      text: query,
      kind: 'modpack',
      gameVersion: version === ANY ? null : version,
      loader: null,
      categories: category === ANY ? [] : [category],
      sort,
      offset,
      limit: PAGE,
    }),
    [provider, query, version, category, sort],
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

  const install = async (project: ModProject): Promise<void> => {
    setInstalling(project.projectId);
    try {
      finishImport(await packsApi.installModpack(project.provider, project.projectId, project.name));
    } catch (raw) {
      fail(raw, () => void install(project));
    }
    setInstalling(null);
  };

  const categoryOptions = useMemo<SelectOption<string>[]>(
    () => [
      { value: ANY, label: t`Все категории` },
      ...categories.map((item) => ({ value: item.id, label: item.name })),
    ],
    [categories],
  );
  const versionOptions = useMemo<SelectOption<string>[]>(
    () => [
      { value: ANY, label: t`Любая версия` },
      ...versions.map((item) => ({ value: item, label: item })),
    ],
    [versions],
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-3.5 pb-2 pl-2 pr-4 pt-1.5">
        <button
          type="button"
          aria-label={t`Назад`}
          title={t`Назад`}
          onClick={back}
          className="glass grid h-9 w-9 shrink-0 place-items-center rounded-full text-text-dim transition-[color,transform] duration-fast hover:text-text active:scale-90"
        >
          <ArrowLeft size={16} strokeWidth={2} />
        </button>
        <h1 className="text-[34px] font-bold leading-[1.1] tracking-[-0.025em] text-text">{t`Модпаки`}</h1>
        <span className="pt-1 text-sm font-medium text-text-dim">{t`каждый ставится отдельной сборкой`}</span>

        {providers.length > 1 && (
          <Segmented
            className="ml-auto"
            label={t`Источник`}
            value={provider}
            options={providers.map((id) => ({ value: id, label: PROVIDER_LABELS[id] }))}
            onChange={setProvider}
          />
        )}
      </header>

      <div className="flex items-center gap-2 pb-3 pl-5 pr-7 pt-2">
        <div className="min-w-0 flex-1">
          <Input
            placeholder={t`Поиск модпаков на ${PROVIDER_LABELS[provider]}`}
            value={text}
            autoFocus
            onChange={(event) => {
              setText(event.target.value);
            }}
            leading={<Search size={14} strokeWidth={1.5} />}
          />
        </div>
        <Select compact className="w-[150px]" value={version} options={versionOptions} onChange={setVersion} />
        <Select compact className="w-[180px]" value={category} options={categoryOptions} onChange={setCategory} />
        <Select compact className="w-[190px]" value={sort} options={SORT_OPTIONS} onChange={setSort} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6 pl-5 pr-7">
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
            description={t`Попробуйте другой запрос, версию или категорию.`}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-2xs text-text-dim">{t`Найдено: `}{total}</p>
            <div className="grid animate-fade-in grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-2">
              {hits.map((project) => (
                <ModCard
                  key={project.projectId}
                  project={project}
                  state={installing === project.projectId ? 'working' : 'idle'}
                  onInstall={() => {
                    if (installing === null) void install(project);
                  }}
                  onOpen={() => {
                    setDescribed({
                      provider: project.provider,
                      projectId: project.projectId,
                      preview: project,
                    });
                  }}
                  onVersions={null}
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
          return (
            <Button
              variant="primary"
              loading={installing === project.projectId}
              disabled={installing !== null && installing !== project.projectId}
              onClick={() => {
                setDescribed(null);
                void install(project);
              }}
            >
              {t`Установить модпак`}</Button>
          );
        }}
      />
    </div>
  );
}
