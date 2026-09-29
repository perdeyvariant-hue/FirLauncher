import { useMemo } from 'react';
import type { ReactElement } from 'react';
import { ArrowUpDown, Plus, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Segmented } from '@/components/ui/Segmented';
import { Select } from '@/components/ui/Select';
import type { SelectOption } from '@/components/ui/Select';
import type { ModLoader } from '@/types/instance';
import { LOADER_LABELS, MOD_LOADERS } from '@/types/instance';
import type { SortKey } from '@/store/useInstances';
import { useInstances } from '@/store/useInstances';
import { t } from '@/lib/i18n';

const ANY = '__any__';

export type InstanceView = 'grid' | 'list';

export interface FilterBarProps {
  view: InstanceView;
  onView: (view: InstanceView) => void;
  onCreate: () => void;
  onImport: () => void;
  onModpacks: () => void;
}

export function FilterBar({ view, onView, onCreate, onImport, onModpacks }: FilterBarProps): ReactElement {
  const filters = useInstances((state) => state.filters);
  const setFilters = useInstances((state) => state.setFilters);
  const instances = useInstances((state) => state.instances);

  const versionOptions = useMemo<SelectOption<string>[]>(() => {
    const versions = [...new Set(instances.map((instance) => instance.mcVersion))].sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true }),
    );
    return [
      { value: ANY, label: t`Все версии` },
      ...versions.map((version) => ({ value: version, label: version })),
    ];
  }, [instances]);

  const loaderOptions: SelectOption<string>[] = [
    { value: ANY, label: t`Все лоадеры` },
    ...MOD_LOADERS.map((loader) => ({ value: loader, label: LOADER_LABELS[loader] })),
  ];

  const sortOptions: SelectOption<SortKey>[] = [
    { value: 'lastPlayed', label: t`По запуску` },
    { value: 'name', label: t`По названию` },
    { value: 'playtime', label: t`По времени в игре` },
    { value: 'created', label: t`По созданию` },
  ];

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <div className="field relative flex h-9 min-w-[170px] max-w-[300px] flex-[1_1_190px] items-center rounded-pill transition-shadow focus-within:shadow-[inset_0_0_0_1px_var(--glass-border),0_0_0_3px_rgb(var(--accent-rgb)/0.35)]">
        <Search size={15} strokeWidth={2} className="pointer-events-none absolute left-[13px] text-text-faint" />
        <input
          value={filters.search}
          onChange={(event) => {
            setFilters({ search: event.target.value });
          }}
          placeholder={t`Поиск сборок`}
          aria-label={t`Поиск сборок`}
          className="h-full w-full bg-transparent pl-9 pr-3.5 text-[13px] text-text outline-none placeholder:text-text-faint"
        />
        {filters.search !== '' && (
          <IconButton
            label={t`Очистить`}
            size="sm"
            className="mr-1"
            icon={<X size={13} strokeWidth={1.75} />}
            onClick={() => {
              setFilters({ search: '' });
            }}
          />
        )}
      </div>

      <Select
        className="w-auto"
        value={filters.version ?? ANY}
        options={versionOptions}
        onChange={(value) => {
          setFilters({ version: value === ANY ? null : value });
        }}
      />

      <Select
        className="w-auto"
        value={filters.loader ?? ANY}
        options={loaderOptions}
        onChange={(value) => {
          setFilters({ loader: value === ANY ? null : (value as ModLoader) });
        }}
      />

      <Select
        className="w-auto"
        value={filters.sort}
        options={sortOptions}
        leading={<ArrowUpDown size={14} strokeWidth={2} className="opacity-70" />}
        onChange={(value) => {
          setFilters({ sort: value });
        }}
      />

      <div className="w-[176px]">
        <Segmented
          fullWidth
          label={t`Вид`}
          value={view}
          options={[
            { value: 'grid', label: t`Сеткой` },
            { value: 'list', label: t`Списком` },
          ]}
          onChange={onView}
        />
      </div>

      {/* The actions travel together: when the row wraps they move to the next line, right-aligned. */}
      <div className="ml-auto flex items-center gap-2">
        <Button className="px-3.5" onClick={onModpacks}>
          {t`Модпаки`}
        </Button>
        <Button className="px-3.5" onClick={onImport}>
          {t`Импорт`}
        </Button>
        <Button variant="primary" icon={<Plus size={15} strokeWidth={2.2} />} onClick={onCreate}>
          {t`Создать`}
        </Button>
      </div>
    </div>
  );
}
