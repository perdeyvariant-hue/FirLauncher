import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Boxes, Plus, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import * as instancesApi from '@/api/instances';
import { activeAccountOf, useAccounts } from '@/store/useAccounts';
import { filterInstances, useInstances } from '@/store/useInstances';
import { useToasts } from '@/store/useToasts';
import { useUI } from '@/store/useUI';
import { ImportDialog } from '@/features/packs/ImportDialog';
import { usePacks } from '@/store/usePacks';
import { CreateInstanceDialog } from './CreateInstanceDialog';
import { FilterBar } from './FilterBar';
import { InstanceCard } from './InstanceCard';

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

  const deleteTarget = instances.find((instance) => instance.id === pendingDelete) ?? null;

  const handlePlay = (id: string): void => {
    if (account === null) {
      notify('Сначала добавьте аккаунт', 'error');
      return;
    }
    void launch(id, account.id);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="hairline-b flex h-14 shrink-0 items-center px-6">
        <h1 className="text-sm font-semibold text-text">Сборки</h1>
        {total > 0 && (
          <span className="ml-2 text-xs text-text-dim">
            {visible.length === total
              ? total
              : `${String(visible.length)} из ${String(total)}`}
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
            title="Пока нет ни одной сборки"
            description="Создайте новую или импортируйте готовую — .mrpack, архив CurseForge либо инстанс MultiMC."
            action={
              <Button
                variant="primary"
                icon={<Plus size={15} strokeWidth={1.5} />}
                onClick={() => {
                  setCreateOpen(true);
                }}
              >
                Создать сборку
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<SearchX size={20} strokeWidth={1.5} />}
            title="Ничего не найдено"
            description="Измените поисковый запрос или сбросьте фильтры."
          />
        ) : (
          <div className="grid animate-fade-in grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
            {visible.map((instance) => (
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
              />
            ))}
          </div>
        )}
      </div>

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
        title={`Удалить «${deleteTarget?.name ?? ''}»?`}
        description="Папка сборки вместе с мирами, модами и настройками будет удалена безвозвратно."
        confirmLabel="Удалить"
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
