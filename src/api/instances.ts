import type {
  InstalledMod,
  Instance,
  ModLoader,
  ResourcePackEntry,
  ScreenshotEntry,
  WorldEntry,
} from '@/types/instance';
import {
  MOCK_INSTANCES,
  MOCK_LOG_LINES,
  MOCK_MODS,
  MOCK_RESOURCEPACKS,
  MOCK_SCREENSHOTS,
  MOCK_WORLDS,
} from '@/mocks/data';
import { ipc, ipcUnit, mocked, shouldMock } from './shared';

export interface CreateInstanceInput {
  readonly name: string;
  readonly mcVersion: string;
  readonly loader: ModLoader;
  readonly loaderVersion: string | null;
  readonly iconPath: string | null;
}

export function listInstances(): Promise<Instance[]> {
  if (shouldMock()) return mocked([...MOCK_INSTANCES]);
  return ipc<Instance[]>('list_instances');
}

export function createInstance(input: CreateInstanceInput): Promise<Instance> {
  if (shouldMock()) {
    const created: Instance = {
      id: `inst-${String(Date.now())}`,
      name: input.name,
      iconPath: input.iconPath,
      mcVersion: input.mcVersion,
      loader: input.loader,
      loaderVersion: input.loaderVersion,
      createdAt: new Date().toISOString(),
      lastPlayedAt: null,
      totalPlaySeconds: 0,
      group: null,
      java: { javaPath: null, memoryMb: null, extraJvmArgs: null, window: null, env: {} },
      status: { state: 'idle' },
    };
    return mocked(created, 400);
  }
  return ipc<Instance>('create_instance', { input });
}

export function deleteInstance(id: string): Promise<void> {
  if (shouldMock()) return mocked(undefined);
  return ipcUnit('delete_instance', { id });
}

export function duplicateInstance(id: string, newName: string): Promise<Instance> {
  if (shouldMock()) {
    const source = MOCK_INSTANCES.find((item) => item.id === id) ?? MOCK_INSTANCES[0];
    if (source === undefined) return Promise.reject(new Error('no instances'));
    return mocked({ ...source, id: `inst-${String(Date.now())}`, name: newName }, 400);
  }
  return ipc<Instance>('duplicate_instance', { id, newName });
}

export function updateInstance(instance: Instance): Promise<Instance> {
  if (shouldMock()) return mocked(instance, 120);
  return ipc<Instance>('update_instance', { instance });
}

export function openInstanceFolder(id: string): Promise<void> {
  if (shouldMock()) return mocked(undefined, 0);
  return ipcUnit('open_instance_folder', { id });
}

export function launchInstance(id: string, accountId: string): Promise<void> {
  if (shouldMock()) return mocked(undefined, 600);
  return ipcUnit('launch_instance', { id, accountId });
}

export function killInstance(id: string): Promise<void> {
  if (shouldMock()) return mocked(undefined);
  return ipcUnit('kill_instance', { id });
}

export function listInstalledMods(id: string): Promise<InstalledMod[]> {
  if (shouldMock()) return mocked([...MOCK_MODS]);
  return ipc<InstalledMod[]>('list_installed_mods', { id });
}

export function setModEnabled(id: string, fileName: string, enabled: boolean): Promise<void> {
  if (shouldMock()) return mocked(undefined, 100);
  return ipcUnit('set_mod_enabled', { id, fileName, enabled });
}

export function removeMod(id: string, fileName: string): Promise<void> {
  if (shouldMock()) return mocked(undefined, 100);
  return ipcUnit('remove_mod', { id, fileName });
}

export function listWorlds(id: string): Promise<WorldEntry[]> {
  if (shouldMock()) return mocked([...MOCK_WORLDS]);
  return ipc<WorldEntry[]>('list_worlds', { id });
}

export function listResourcePacks(id: string): Promise<ResourcePackEntry[]> {
  if (shouldMock()) return mocked([...MOCK_RESOURCEPACKS]);
  return ipc<ResourcePackEntry[]>('list_resource_packs', { id });
}

export function listShaderPacks(id: string): Promise<ResourcePackEntry[]> {
  if (shouldMock()) {
    return mocked<ResourcePackEntry[]>([
      {
        fileName: 'ComplementaryReimagined_r5.9.3.zip',
        name: 'ComplementaryReimagined_r5.9.3',
        description: null,
        sizeBytes: 552_960,
        packFormat: null,
        source: {
          provider: 'modrinth',
          projectId: 'HVnmMxH1',
          versionId: 'HVnmMxH1-v',
          versionNumber: 'r5.9.3',
        },
      },
    ]);
  }
  return ipc<ResourcePackEntry[]>('list_shader_packs', { id });
}

export function listScreenshots(id: string): Promise<ScreenshotEntry[]> {
  if (shouldMock()) return mocked([...MOCK_SCREENSHOTS]);
  return ipc<ScreenshotEntry[]>('list_screenshots', { id });
}

export function readRecentLog(id: string): Promise<string[]> {
  if (shouldMock()) return mocked([...MOCK_LOG_LINES]);
  return ipc<string[]>('read_recent_log', { id });
}
