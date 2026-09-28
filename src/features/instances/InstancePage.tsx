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
import { Cover, LiveDot, loaderLabel } from './InstanceCard';
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
import { ServersTab } from './tabs/ServersTab';
import { WorldsTab } from './tabs/WorldsTab';
import { t } from '@/lib/i18n';

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
        title={t`Сборка не найдена`}
        description={t`Возможно, она была удалена.`}
        action={
          <Button
            onClick={() => {
              navigate({ name: 'instances' });
            }}
          >
            {t`К списку сборок`}</Button>
        }
      />
    );
  }

  const running = instance.status.state === 'running';

  const play = (): void => {
    if (account === null) {
      notify(t`Сначала добавьте аккаунт`, 'error');
      return;
    }
    void launch(instance.id, account.id);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-col gap-4 pb-3 pl-2 pr-4 pt-1.5">
        <div className="flex items-center gap-3.5">
          <button
            type="button"
            aria-label={t`Назад`}
            title={t`Назад`}
            onClick={back}
            className="glass grid h-9 w-9 shrink-0 place-items-center rounded-full text-text-dim transition-[color,transform] duration-fast hover:text-text active:scale-90"
          >
            <ArrowLeft size={16} strokeWidth={2} />
          </button>

          <Cover instance={instance} size="hero" className="h-16 w-16 shrink-0 rounded-[18px]" />

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[26px] font-bold leading-tight tracking-[-0.025em] text-text">
              {instance.name}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge tone="outline">{instance.mcVersion}</Badge>
              <Badge>{loaderLabel(instance)}</Badge>
              {running && (
                <span className="inline-flex h-[21px] items-center gap-1.5 rounded-pill bg-[rgb(74_222_128/0.14)] px-2 text-[11px] font-semibold text-success">
                  <LiveDot />
                  {t`Запущена`}
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <IconButton
              label={t`Открыть папку`}
              icon={<FolderOpen size={16} strokeWidth={1.75} />}
              onClick={() => {
                void instancesApi
                  .openInstanceFolder(instance.id)
                  .catch((raw: unknown) => fail(raw));
              }}
            />
            <IconButton
              label={t`Экспорт`}
              icon={<Share2 size={16} strokeWidth={1.75} />}
              onClick={() => {
                openExport(instance);
              }}
            />
            <IconButton
              label={t`Удалить сборку`}
              tone="danger"
              icon={<Trash2 size={16} strokeWidth={1.75} />}
              onClick={() => {
                setConfirmDelete(true);
              }}
            />
            {running ? (
              <Button
                variant="danger"
                size="lg"
                className="ml-1.5"
                icon={<Square size={14} strokeWidth={1.5} fill="currentColor" />}
                onClick={() => {
                  void instancesApi.killInstance(instance.id).catch((raw: unknown) => fail(raw));
                }}
              >
                {t`Остановить`}</Button>
            ) : (
              <Button
                iridescent
                size="lg"
                className="ml-1.5"
                icon={<Play size={15} strokeWidth={1.5} fill="currentColor" />}
                onClick={play}
              >
                {t`Играть`}</Button>
            )}
          </div>
        </div>

        <Tabs value={tab} items={TAB_ITEMS} onChange={setInstanceTab} />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-6 pl-2 pr-4">
        <div key={tab} className="h-full animate-sheet-in">
          {tab === 'overview' && <OverviewTab instance={instance} />}
          {tab === 'mods' && <ModsTab instance={instance} />}
          {tab === 'worlds' && <WorldsTab instance={instance} />}
          {tab === 'servers' && <ServersTab instance={instance} />}
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
        title={t`Удалить «${instance.name}»?`}
        description={t`Папка сборки вместе с мирами, модами и настройками будет удалена безвозвратно.`}
        confirmLabel={t`Удалить`}
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
