import { useRef, useState } from 'react';
import type { ReactElement } from 'react';
import * as modsApi from '@/api/mods';
import type { ContentKind } from '@/api/mods';
import type { Instance } from '@/types/instance';
import type { ProviderId, ResolvedInstallPlan } from '@/types/mod';
import { useToasts } from '@/store/useToasts';
import { DependencyDialog } from './DependencyDialog';
import { VersionDialog } from './VersionDialog';
import type { VersionTarget } from './VersionDialog';

export interface ContentInstaller {
  /**
   * Resolves and installs a project (a specific version when `versionId` is
   * set). Asks first when dependencies come along. Settles once the user is
   * done: true if something was installed.
   */
  install: (provider: ProviderId, projectId: string, versionId?: string | null) => Promise<boolean>;
  /** Opens the version picker; picking a version installs it. */
  chooseVersion: (target: VersionTarget) => void;
  /** The dialogs this hook drives; render them once. */
  dialogs: ReactElement;
}

/**
 * Install flow shared by the browser and the installed lists: resolve →
 * (confirm dependencies) → download, with a version picker in front.
 */
export function useContentInstaller(
  instance: Instance,
  kind: ContentKind,
  onInstalled: (plan: ResolvedInstallPlan) => void,
): ContentInstaller {
  const notify = useToasts((store) => store.notify);
  const fail = useToasts((store) => store.fail);

  const [plan, setPlan] = useState<ResolvedInstallPlan | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [versionTarget, setVersionTarget] = useState<VersionTarget | null>(null);
  const [versionBusy, setVersionBusy] = useState(false);
  // Settles the promise of the install waiting on the dependency dialog.
  const settle = useRef<((installed: boolean) => void) | null>(null);

  const run = async (target: ResolvedInstallPlan): Promise<void> => {
    await modsApi.installPlan(instance.id, kind, target);
    const extra = target.dependencies.length;
    notify(
      extra === 0
        ? `Установлено: ${target.primary.name} ${target.primary.versionNumber}`
        : `Установлено: ${target.primary.name} и зависимости (${String(extra)})`,
      'success',
    );
    onInstalled(target);
  };

  const install = async (
    provider: ProviderId,
    projectId: string,
    versionId: string | null = null,
  ): Promise<boolean> => {
    try {
      const resolved = await modsApi.resolveInstall(
        instance.id,
        provider,
        projectId,
        kind,
        versionId,
      );
      // Nothing else comes along: no reason to ask.
      if (resolved.dependencies.length === 0 && resolved.unresolved.length === 0) {
        await run(resolved);
        return true;
      }
      return await new Promise<boolean>((resolve) => {
        settle.current = resolve;
        setPlan(resolved);
      });
    } catch (raw) {
      fail(raw, () => void install(provider, projectId, versionId));
      return false;
    }
  };

  const closePlan = (installed: boolean): void => {
    setPlan(null);
    settle.current?.(installed);
    settle.current = null;
  };

  const confirmPlan = async (): Promise<void> => {
    if (plan === null) return;
    setPlanBusy(true);
    let installed = false;
    try {
      await run(plan);
      installed = true;
    } catch (raw) {
      fail(raw);
    }
    setPlanBusy(false);
    closePlan(installed);
  };

  const pickVersion = async (target: VersionTarget, versionId: string): Promise<void> => {
    setVersionBusy(true);
    // The picker steps aside so a dependency dialog is not stacked on it.
    setVersionTarget(null);
    await install(target.provider, target.projectId, versionId);
    setVersionBusy(false);
  };

  const dialogs = (
    <>
      <VersionDialog
        instance={instance}
        kind={kind}
        target={versionTarget}
        busy={versionBusy}
        onPick={(version) => {
          if (versionTarget !== null) void pickVersion(versionTarget, version.versionId);
        }}
        onClose={() => {
          setVersionTarget(null);
        }}
      />
      <DependencyDialog
        plan={plan}
        kind={kind}
        busy={planBusy}
        onConfirm={() => {
          void confirmPlan();
        }}
        onCancel={() => {
          closePlan(false);
        }}
      />
    </>
  );

  return { install, chooseVersion: setVersionTarget, dialogs };
}
