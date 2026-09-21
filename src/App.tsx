import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { AccountsPage } from '@/features/accounts/AccountsPage';
import { InstancePage } from '@/features/instances/InstancePage';
import { InstancesPage } from '@/features/instances/InstancesPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { ModpacksPage } from '@/features/packs/ModpacksPage';
import { onEvent } from '@/lib/events';
import { useAccounts } from '@/store/useAccounts';
import { useInstances } from '@/store/useInstances';
import { useSettings } from '@/store/useSettings';
import { useTasks } from '@/store/useTasks';
import { useToasts } from '@/store/useToasts';
import { useUI } from '@/store/useUI';

function CurrentPage(): ReactElement {
  const route = useUI((state) => state.route);

  switch (route.name) {
    case 'accounts':
      return <AccountsPage />;
    case 'settings':
      return <SettingsPage />;
    case 'modpacks':
      return <ModpacksPage />;
    case 'instance':
      return <InstancePage instanceId={route.id} tab={route.tab} />;
    case 'instances':
    default:
      return <InstancesPage />;
  }
}

export default function App(): ReactElement {
  const loadSettings = useSettings((state) => state.load);
  const loadInstances = useInstances((state) => state.load);
  const loadAccounts = useAccounts((state) => state.load);
  const loadTasks = useTasks((state) => state.load);
  const subscribeAccounts = useAccounts((state) => state.subscribe);
  const subscribeTasks = useTasks((state) => state.subscribe);

  useEffect(() => {
    void loadSettings();
    void loadInstances();
    void loadAccounts();
    void loadTasks();
  }, [loadSettings, loadInstances, loadAccounts, loadTasks]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;

    void subscribeTasks().then((fn) => {
      if (disposed) fn();
      else unsubscribe = fn;
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [subscribeTasks]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    void subscribeAccounts().then((fn) => {
      if (disposed) fn();
      else unsubscribe = fn;
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [subscribeAccounts]);

  // A launch flips the instance to "running" and an exit flips it back, so the
  // grid is refreshed on both edges rather than polled.
  useEffect(() => {
    let disposed = false;
    const unsubscribers: (() => void)[] = [];

    const track = (promise: Promise<() => void>): void => {
      void promise.then((fn) => {
        if (disposed) fn();
        else unsubscribers.push(fn);
      });
    };

    track(
      onEvent('game://exit', (payload) => {
        void loadInstances();
        if (payload.crashed) {
          useToasts.getState().push({
            tone: 'error',
            title: 'Игра завершилась с ошибкой',
            detail: `Код выхода ${String(payload.exitCode)}. Откройте вкладку «Логи» этой сборки.`,
            onRetry: null,
          });
        }
      }),
    );

    track(
      onEvent('task://finished', (task) => {
        if (task.instanceId !== null) void loadInstances();
      }),
    );

    return () => {
      disposed = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [loadInstances]);

  return (
    <AppShell>
      <CurrentPage />
    </AppShell>
  );
}
