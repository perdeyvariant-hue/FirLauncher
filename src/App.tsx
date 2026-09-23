import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { AccountsPage } from '@/features/accounts/AccountsPage';
import { AppearancePage } from '@/features/appearance/AppearancePage';
import { DirectLaunch } from '@/features/launch/DirectLaunch';
import { InstancePage } from '@/features/instances/InstancePage';
import { InstancesPage } from '@/features/instances/InstancesPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { ModpacksPage } from '@/features/packs/ModpacksPage';
import { onEvent } from '@/lib/events';
import { useAccounts } from '@/store/useAccounts';
import { useInstances } from '@/store/useInstances';
import { useSettings } from '@/store/useSettings';
import { useTasks } from '@/store/useTasks';
import { useUI } from '@/store/useUI';
import { useUpdater } from '@/store/useUpdater';
import { useCrash } from '@/store/useCrash';
import { takeStartupLaunch } from '@/api/shortcuts';
import * as windowApi from '@/api/window';
import { activeAccountOf } from '@/store/useAccounts';
import { useToasts } from '@/store/useToasts';
import { t } from '@/lib/i18n';

/**
 * The backend answers `--launch <id>` once, and React 18 runs effects twice
 * in development, so the answer is remembered here.
 */
let startupLaunchOnce: Promise<string | null> | null = null;
function startupLaunch(): Promise<string | null> {
  startupLaunchOnce ??= takeStartupLaunch();
  return startupLaunchOnce;
}

/** A desktop shortcut asked to start this instance while the launcher was open. */
function launchFromShortcut(id: string): void {
  const account = activeAccountOf(useAccounts.getState());
  const instance = useInstances.getState().instances.find((item) => item.id === id);
  if (instance === undefined) {
    useToasts.getState().notify(t`Сборка из ярлыка не найдена — возможно, её удалили`, 'error');
    return;
  }
  useUI.getState().openInstance(id, 'logs');
  if (account === null) {
    useToasts.getState().notify(t`Сначала добавьте аккаунт`, 'error');
    return;
  }
  void useInstances.getState().launch(id, account.id);
}

function CurrentPage(): ReactElement {
  const route = useUI((state) => state.route);

  switch (route.name) {
    case 'accounts':
      return <AccountsPage />;
    case 'settings':
      return <SettingsPage />;
    case 'appearance':
      return <AppearancePage />;
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

  /** Non-null while a shortcut launch owns the window. */
  const [shortcutLaunch, setShortcutLaunch] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Asked for first: the window is hidden until the launch card can be shown.
  useEffect(() => {
    void startupLaunch().then(setShortcutLaunch);
  }, []);

  useEffect(() => {
    void loadSettings().then(() => {
      // Quietly: no network or no release yet must not greet the user with an error.
      if (useSettings.getState().settings.checkForUpdates) void useUpdater.getState().check(true);
    });
    void Promise.all([loadInstances(), loadAccounts()]).then(() => {
      setLoaded(true);
    });
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
      onEvent('game://started', () => {
        // A shortcut launch hides the launcher outright; this is the setting
        // for an ordinary one.
        if (shortcutLaunch !== null) return;
        if (useSettings.getState().settings.closeLauncherOnLaunch) void windowApi.minimizeLauncher();
      }),
    );

    track(
      onEvent('game://exit', (payload) => {
        void loadInstances();
        // A crash opens the crash assistant with the diagnosis.
        if (payload.crashed) void useCrash.getState().open(payload.instanceId);
      }),
    );

    track(
      onEvent('launch://request', (id) => {
        launchFromShortcut(id);
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
  }, [loadInstances, shortcutLaunch]);

  // Read through a ref so the callback stays stable and the launch card
  // does not resubscribe to game events on every render.
  const shortcutRef = useRef(shortcutLaunch);
  shortcutRef.current = shortcutLaunch;

  const openLauncher = useCallback((): void => {
    const id = shortcutRef.current;
    if (id !== null) useUI.getState().openInstance(id, 'logs');
    setShortcutLaunch(null);
  }, []);

  if (shortcutLaunch !== null) {
    return (
      <DirectLaunch instanceId={shortcutLaunch} ready={loaded} onOpenLauncher={openLauncher} />
    );
  }

  return (
    <AppShell>
      <CurrentPage />
    </AppShell>
  );
}
