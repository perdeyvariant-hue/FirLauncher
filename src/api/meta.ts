import type { LoaderVersion, MinecraftVersion } from '@/types/version';
import type { ModLoader } from '@/types/instance';
import type { JavaRuntime, SystemMemory } from '@/types/java';
import type { Settings } from '@/types/settings';
import { MOCK_JAVA, MOCK_VERSIONS } from '@/mocks/data';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { ipc, mocked, shouldMock } from './shared';

export function listMinecraftVersions(): Promise<MinecraftVersion[]> {
  if (shouldMock()) return mocked([...MOCK_VERSIONS]);
  return ipc<MinecraftVersion[]>('list_minecraft_versions');
}

export function listLoaderVersions(
  loader: ModLoader,
  mcVersion: string,
): Promise<LoaderVersion[]> {
  if (shouldMock()) {
    if (loader === 'vanilla') return mocked([]);
    return mocked<LoaderVersion[]>([
      { version: '0.16.9', stable: true, recommended: true },
      { version: '0.16.7', stable: true, recommended: false },
      { version: '0.17.0-beta.1', stable: false, recommended: false },
    ]);
  }
  return ipc<LoaderVersion[]>('list_loader_versions', { loader, mcVersion });
}

export function listJavaRuntimes(): Promise<JavaRuntime[]> {
  if (shouldMock()) return mocked([...MOCK_JAVA]);
  return ipc<JavaRuntime[]>('list_java_runtimes');
}

export function systemMemory(): Promise<SystemMemory> {
  if (shouldMock()) return mocked<SystemMemory>({ totalMb: 32_768, availableMb: 21_504 });
  return ipc<SystemMemory>('system_memory');
}

export function loadSettings(): Promise<Settings> {
  if (shouldMock()) return mocked(DEFAULT_SETTINGS, 60);
  return ipc<Settings>('load_settings');
}

export interface BuildInfo {
  /** The CurseForge key is baked into this build and cannot be changed. */
  readonly curseforgeKeyBuiltin: boolean;
  /** A Discord application id is baked into this build. */
  readonly discordAppIdBuiltin: boolean;
}

export function buildInfo(): Promise<BuildInfo> {
  if (shouldMock()) return mocked<BuildInfo>({ curseforgeKeyBuiltin: false, discordAppIdBuiltin: false });
  return ipc<BuildInfo>('build_info');
}

export function saveSettings(settings: Settings): Promise<Settings> {
  if (shouldMock()) return mocked(settings, 60);
  return ipc<Settings>('save_settings', { settings });
}
