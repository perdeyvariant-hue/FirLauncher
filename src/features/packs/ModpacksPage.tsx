import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { ArrowLeft, PackageSearch, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorBlock } from '@/components/ui/ErrorBlock';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { SelectOption } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import * as metaApi from '@/api/meta';
import * as modsApi from '@/api/mods';
import * as packsApi from '@/api/packs';
import { openExternal } from '@/api/system';
import { ModCard } from '@/features/mods/ModCard';
import { toLauncherError } from '@/lib/ipc';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import type { LauncherError } from '@/types/error';
import type { Category, ModProject, ProviderId, SearchQuery } from '@/types/mod';
import { PROVIDER_LABELS } from '@/types/mod';
import { usePacks } from '@/store/usePacks';
import { useToasts } from '@/store/useToasts';
import { useUI } from '@/store/useUI';

const PAGE = 20;
const ANY = '__any__';
type Sort = SearchQuery['sort'];

const SORT_OPTIONS: SelectOption<Sort>[] = [
  { value: 'relevance', label: 'По релевантности' },
  { value: 'downloads', label: 'По загрузкам' },
  { value: 'follows', label: 'По популярности' },
  { value: 'updated', label: 'Недавно обновлённые' },
  { value: 'newest', label: 'Новые' },
];

/** Search and one-click install of modpacks, each becoming a new instance. */
export function ModpacksPage(): ReactElement {
  const back = useUI((state) => state.back);
  const finishImport = usePacks((state) => state.finishImport);
  const fail = useToasts((state) => state.fail);

  const [providers, setProviders] = useState<ProviderId[]>(['modrinth']);
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
      { value: ANY, label: 'Все категории' },
      ...categories.map((item) => ({ value: item.id, label: item.name })),
    ],
    [categories],
  );
  const versionOptions = useMemo<SelectOption<string>[]>(
    () => [
      { value: ANY, label: 'Любая версия' },
      ...versions.map((item) => ({ value: item, label: item })),
    ],
    [versions],
  );

  return (
    <div className="flex h-full flex-col">
      <header className="hairline-b flex h-14 shrink-0 items-center gap-2 px-6">
        <IconButton label="Назад" icon={<ArrowLeft size={16} strokeWidth={1.5} />} onClick={back} />
        <h1 className="text-sm font-semibold text-text">Модпаки</h1>
        <span className="text-xs text-text-dim">каждый ставится отдельной сборкой</span>

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
                  id === provider ? 'bg-accent text-white' : 'text-text-dim hover:text-text',
                )}
              >
                {PROVIDER_LABELS[id]}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="flex items-center gap-2 px-6 py-3">
        <div className="min-w-0 flex-1">
          <Input
            placeholder={`Поиск модпаков на ${PROVIDER_LABELS[provider]}`}
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

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
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
            title="Ничего не найдено"
            description="Попробуйте другой запрос, версию или категорию."
          />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-2xs text-text-dim">Найдено: {total}</p>
            <div className="grid animate-fade-in grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-2">
              {hits.map((project) => (
                <ModCard
                  key={project.projectId}
                  project={project}
                  state={installing === project.projectId ? 'working' : 'idle'}
                  onInstall={() => {
                    if (installing === null) void install(project);
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
                  Показать ещё
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
