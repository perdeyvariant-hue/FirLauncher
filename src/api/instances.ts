import type {
  InstalledMod,
  Instance,
  ModLoader,
  ResourcePackEntry,
  ScreenshotEntry,
  WorldBackup,
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
import { t } from '@/lib/i18n';

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
      favorite: false,
      java: { javaPath: null, javaMajor: null, memoryMb: null, extraJvmArgs: null, window: null, env: {} },
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

/** `server` joins that server right after the game starts. */
export function launchInstance(id: string, accountId: string, server: string | null = null): Promise<void> {
  if (shouldMock()) return mocked(undefined, 600);
  return ipcUnit('launch_instance', { id, accountId, server });
}

/** Copies a file into mods/, resourcepacks/ or shaderpacks/; resolves with its name. */
export function addContentFile(
  id: string,
  kind: 'mod' | 'resourcepack' | 'shader',
  path: string,
): Promise<string> {
  if (shouldMock()) return mocked(path.split(/[\\/]/).pop() ?? path, 200);
  return ipc<string>('add_content_file', { id, kind, path });
}

export interface ServerEntry {
  readonly name: string;
  readonly address: string;
  /** The icon the game cached, as a data URL. */
  readonly icon: string | null;
}

export interface ServerStatus {
  readonly online: number;
  readonly max: number;
  readonly version: string;
  readonly motd: string;
  readonly latencyMs: number;
  readonly favicon: string | null;
}

export function listServers(id: string): Promise<ServerEntry[]> {
  if (shouldMock()) {
    return mocked<ServerEntry[]>([
      { name: 'Hypixel', address: 'mc.hypixel.net', icon: null },
      { name: t`Мой сервер`, address: 'play.example.net:25570', icon: null },
    ]);
  }
  return ipc<ServerEntry[]>('list_servers', { id });
}

export function addServer(id: string, name: string, address: string): Promise<void> {
  if (shouldMock()) return mocked(undefined, 100);
  return ipcUnit('add_server', { id, name, address });
}

export function removeServer(id: string, index: number): Promise<void> {
  if (shouldMock()) return mocked(undefined, 100);
  return ipcUnit('remove_server', { id, index });
}

export function pingServer(address: string): Promise<ServerStatus> {
  if (shouldMock()) {
    return address.includes('example')
      ? Promise.reject(new Error(t`Сервер не отвечает`))
      : mocked<ServerStatus>(
          { online: 24_702, max: 200_000, version: '1.8 / 1.21', motd: 'Hypixel Network  SKYBLOCK', latencyMs: 42, favicon: null },
          500,
        );
  }
  return ipc<ServerStatus>('ping_server', { address });
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

export function listWorldBackups(id: string): Promise<WorldBackup[]> {
  if (shouldMock()) {
    return mocked<WorldBackup[]>([
      {
        fileName: 'New World__2026-09-20_18-00-00.zip',
        world: 'New World',
        createdAt: '2026-09-20T18:00:00',
        sizeBytes: 38_000_000,
        automatic: false,
      },
      {
        fileName: 'New World__2026-09-21_10-00-00__auto.zip',
        world: 'New World',
        createdAt: '2026-09-21T10:00:00',
        sizeBytes: 39_000_000,
        automatic: true,
      },
    ]);
  }
  return ipc<WorldBackup[]>('list_world_backups', { id });
}

export function backupWorld(id: string, world: string): Promise<WorldBackup> {
  if (shouldMock()) return Promise.reject(new Error(t`Доступно только в приложении`));
  return ipc<WorldBackup>('backup_world', { id, world });
}

/** Resolves with the restored world's folder name. */
export function restoreWorldBackup(id: string, fileName: string): Promise<string> {
  if (shouldMock()) return mocked('New World', 500);
  return ipc<string>('restore_world_backup', { id, fileName });
}

export function deleteWorldBackup(id: string, fileName: string): Promise<void> {
  if (shouldMock()) return mocked(undefined, 100);
  return ipcUnit('delete_world_backup', { id, fileName });
}

/** Resolves with the imported world's folder name. */
export function importWorld(id: string, path: string): Promise<string> {
  if (shouldMock()) return Promise.reject(new Error(t`Доступно только в приложении`));
  return ipc<string>('import_world', { id, path });
}

export function deleteWorld(id: string, world: string): Promise<void> {
  if (shouldMock()) return mocked(undefined, 100);
  return ipcUnit('delete_world', { id, world });
}

export async function pickWorldArchive(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ multiple: false, filters: [{ name: t`Мир Minecraft`, extensions: ['zip'] }] });
  return typeof picked === 'string' ? picked : null;
}
