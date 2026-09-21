import { useState } from 'react';
import type { ReactElement } from 'react';
import { ArrowLeft, Boxes, FolderOpen, Play, Share2, Square, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconButton } from '@/components/ui/IconButton';
import { Tabs } from '@/components/ui/Tabs';
import type { TabItem } from '@/components/ui/Tabs';
import * as instancesApi from '@/api/instances';
import { initialsOf } from '@/lib/format';
import { LOADER_LABELS } from '@/types/instance';
import type { InstanceTab } from '@/types/route';
import { INSTANCE_TABS, INSTANCE_TAB_LABELS } from '@/types/route';
import { activeAccountOf, useAccounts } from '@/store/useAccounts';
import { useInstances } from '@/store/useInstances';
import { useToasts } from '@/store/useToasts';
import { usePacks } from '@/store/usePacks';
import { useUI } from '@/store/useUI';
import { InstanceSettingsTab } from './tabs/InstanceSettingsTab';
import { LogsTab } from './tabs/LogsTab';
import { ModsTab } from './tabs/ModsTab';
import { OverviewTab } from './tabs/OverviewTab';
import { PacksTab } from './tabs/PacksTab';
import { ScreenshotsTab } from './tabs/ScreenshotsTab';
import { WorldsTab } from './tabs/WorldsTab';

export interface InstancePageProps {
  instanceId: string;
  tab: InstanceTab;
}

const TAB_ITEMS: readonly TabItem<InstanceTab>[] = INSTANCE_TABS.map((tab) => ({
  value: tab,
  label: INSTANCE_TAB_LABELS[tab],
}));

export function InstancePage({ instanceId, tab }: InstancePageProps): ReactElement {
  const instance = useInstances((state) =>
    state.instances.find((item) => item.id === instanceId) ?? null,
  );
  const remove = useInstances((state) => state.remove);
  const launch = useInstances((state) => state.launch);
  const setInstanceTab = useUI((state) => state.setInstanceTab);
  const navigate = useUI((state) => state.navigate);
  const back = useUI((state) => state.back);
  const account = useAccounts(activeAccountOf);
  const notify = useToasts((state) => state.notify);
  const fail = useToasts((state) => state.fail);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const openExport = usePacks((state) => state.openExport);

  if (instance === null) {
    return (
      <EmptyState
        icon={<Boxes size={20} strokeWidth={1.5} />}
        title="Сборка не найдена"
        description="Возможно, она была удалена."
        action={
          <Button
            onClick={() => {
              navigate({ name: 'instances' });
            }}
          >
            К списку сборок
          </Button>
        }
      />
    );
  }

  const running = instance.status.state === 'running';

  const play = (): void => {
    if (account === null) {
      notify('Сначала добавьте аккаунт', 'error');
      return;
    }
    void launch(instance.id, account.id);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-col px-6 pt-4">
        <div className="flex items-start gap-3">
          <IconButton
            label="Назад"
            icon={<ArrowLeft size={16} strokeWidth={1.5} />}
            onClick={back}
          />

          {instance.iconPath === null ? (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-sm font-semibold text-text-dim">
              {initialsOf(instance.name)}
            </span>
          ) : (
            <img
              src={instance.iconPath}
              alt=""
              className="h-11 w-11 shrink-0 rounded-lg object-cover"
              style={{ imageRendering: 'pixelated' }}
            />
          )}

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold text-text">{instance.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <Badge tone="outline">{instance.mcVersion}</Badge>
              {instance.loader !== 'vanilla' && (
                <Badge tone="neutral">
                  {LOADER_LABELS[instance.loader]}
                  {instance.loaderVersion !== null && ` ${instance.loaderVersion}`}
                </Badge>
              )}
              {running && <Badge tone="accent">Запущена</Badge>}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <IconButton
              label="Открыть папку"
              icon={<FolderOpen size={16} strokeWidth={1.5} />}
              onClick={() => {
                void instancesApi
                  .openInstanceFolder(instance.id)
                  .catch((raw: unknown) => fail(raw));
              }}
            />
            <IconButton
              label="Экспорт"
              icon={<Share2 size={16} strokeWidth={1.5} />}
              onClick={() => {
                openExport(instance);
              }}
            />
            <IconButton
              label="Удалить сборку"
              tone="danger"
              icon={<Trash2 size={16} strokeWidth={1.5} />}
              onClick={() => {
                setConfirmDelete(true);
              }}
            />
            {running ? (
              <Button
                variant="danger"
                icon={<Square size={15} strokeWidth={1.5} />}
                onClick={() => {
                  void instancesApi.killInstance(instance.id).catch((raw: unknown) => fail(raw));
                }}
              >
                Остановить
              </Button>
            ) : (
              <Button
                variant="primary"
                icon={<Play size={15} strokeWidth={1.5} fill="currentColor" />}
                onClick={play}
              >
                Играть
              </Button>
            )}
          </div>
        </div>

        <div className="hairline-b -mx-6 mt-3 px-6">
          <Tabs value={tab} items={TAB_ITEMS} onChange={setInstanceTab} />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="animate-fade-in h-full">
          {tab === 'overview' && <OverviewTab instance={instance} />}
          {tab === 'mods' && <ModsTab instance={instance} />}
          {tab === 'worlds' && <WorldsTab instance={instance} />}
          {tab === 'resourcepacks' && <PacksTab instance={instance} kind="resourcepack" />}
          {tab === 'shaders' && <PacksTab instance={instance} kind="shader" />}
          {tab === 'screenshots' && <ScreenshotsTab instance={instance} />}
          {tab === 'logs' && <LogsTab instance={instance} />}
          {tab === 'settings' && <InstanceSettingsTab instance={instance} />}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        destructive
        title={`Удалить «${instance.name}»?`}
        description="Папка сборки вместе с мирами, модами и настройками будет удалена безвозвратно."
        confirmLabel="Удалить"
        onCancel={() => {
          setConfirmDelete(false);
        }}
        onConfirm={() => {
          setConfirmDelete(false);
          void remove(instance.id);
          navigate({ name: 'instances' });
        }}
      />
    </div>
  );
}
