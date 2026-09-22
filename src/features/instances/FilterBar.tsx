import { useMemo } from 'react';
import type { ReactElement } from 'react';
import { Download, PackageSearch, Plus, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { SelectOption } from '@/components/ui/Select';
import type { ModLoader } from '@/types/instance';
import { LOADER_LABELS, MOD_LOADERS } from '@/types/instance';
import type { SortKey } from '@/store/useInstances';
import { useInstances } from '@/store/useInstances';
import { t } from '@/lib/i18n';

const ANY = '__any__';

export interface FilterBarProps {
  onCreate: () => void;
  onImport: () => void;
  onModpacks: () => void;
}

export function FilterBar({ onCreate, onImport, onModpacks }: FilterBarProps): ReactElement {
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
    { value: 'lastPlayed', label: t`По последнему запуску` },
    { value: 'name', label: t`По имени` },
    { value: 'playtime', label: t`По времени игры` },
    { value: 'created', label: t`По дате создания` },
  ];

  const hasFilters =
    filters.search !== '' || filters.version !== null || filters.loader !== null;

  return (
    <div className="flex items-center gap-2 px-6 py-3">
      <div className="w-[260px]">
        <Input
          placeholder={t`Поиск сборок`}
          value={filters.search}
          onChange={(event) => {
            setFilters({ search: event.target.value });
          }}
          leading={<Search size={14} strokeWidth={1.5} />}
          trailing={
            filters.search === '' ? undefined : (
              <IconButton
                label={t`Очистить`}
                size="sm"
                icon={<X size={13} strokeWidth={1.5} />}
                onClick={() => {
                  setFilters({ search: '' });
                }}
              />
            )
          }
        />
      </div>

      <Select
        compact
        className="w-[150px]"
        value={filters.version ?? ANY}
        options={versionOptions}
        onChange={(value) => {
          setFilters({ version: value === ANY ? null : value });
        }}
      />

      <Select
        compact
        className="w-[150px]"
        value={filters.loader ?? ANY}
        options={loaderOptions}
        onChange={(value) => {
          setFilters({ loader: value === ANY ? null : (value as ModLoader) });
        }}
      />

      <Select
        compact
        className="w-[190px]"
        value={filters.sort}
        options={sortOptions}
        onChange={(value) => {
          setFilters({ sort: value });
        }}
      />

      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setFilters({ search: '', version: null, loader: null });
          }}
        >
          {t`Сбросить`}</Button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Button icon={<Download size={15} strokeWidth={1.5} />} onClick={onImport}>
          {t`Импорт`}</Button>
        <Button icon={<PackageSearch size={15} strokeWidth={1.5} />} onClick={onModpacks}>
          {t`Модпаки`}</Button>
        <Button variant="primary" icon={<Plus size={15} strokeWidth={1.5} />} onClick={onCreate}>
          {t`Создать сборку`}</Button>
      </div>
    </div>
  );
}
