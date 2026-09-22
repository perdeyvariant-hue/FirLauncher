import type { ProviderId } from '@/types/mod';
import type {
  ExportFormat,
  ExportSummary,
  ImportResult,
  ModpackInfo,
  ModpackUpdate,
  ModpackUpdateSummary,
} from '@/types/pack';
import { MOCK_INSTANCES } from '@/mocks/data';
import { ipc, mocked, shouldMock } from './shared';
import { t } from '@/lib/i18n';

function mockImport(name: string): Promise<ImportResult> {
  const base = MOCK_INSTANCES[1];
  if (base === undefined) return Promise.reject(new Error('no fixtures'));
  return mocked<ImportResult>(
    {
      instance: { ...base, id: `imported-${String(Date.now())}`, name },
      skipped: [
        {
          name: 'Just Enough Items',
          url: 'https://www.curseforge.com/minecraft/mc-mods/jei',
          reason: t`Автор запретил скачивание через сторонние лаунчеры`,
        },
      ],
    },
    1200,
  );
}

/** A .mrpack, CurseForge zip, MultiMC/Prism instance (zip or folder) or FirLauncher archive. */
export function importPack(path: string): Promise<ImportResult> {
  if (shouldMock()) return mockImport(t`Импортированная сборка`);
  return ipc<ImportResult>('import_pack', { path });
}

export function installModpack(
  provider: ProviderId,
  projectId: string,
  name: string,
): Promise<ImportResult> {
  if (shouldMock()) return mockImport(name);
  return ipc<ImportResult>('install_modpack', { provider, projectId, name });
}

export function exportInstance(
  id: string,
  format: ExportFormat,
  destination: string,
): Promise<ExportSummary> {
  if (shouldMock()) return mocked<ExportSummary>({ linked: 47, embedded: 29, bytes: 66_560 }, 900);
  return ipc<ExportSummary>('export_instance', { id, format, destination });
}

/** Native file pickers; outside the app window they are simply unavailable. */
export async function pickPackFile(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({
    multiple: false,
    filters: [{ name: t`Сборка`, extensions: ['mrpack', 'zip'] }],
  });
  return typeof picked === 'string' ? picked : null;
}

export async function pickInstanceFolder(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ directory: true, multiple: false });
  return typeof picked === 'string' ? picked : null;
}

export async function pickExportPath(defaultName: string, format: ExportFormat): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const extension = format === 'mrpack' ? 'mrpack' : 'zip';
  const picked = await save({
    defaultPath: defaultName,
    filters: [{ name: format === 'mrpack' ? t`Модпак Modrinth` : t`Архив`, extensions: [extension] }],
  });
  return picked ?? null;
}

export function modpackInfo(id: string): Promise<ModpackInfo | null> {
  if (shouldMock()) {
    return mocked<ModpackInfo | null>(
      id === 'inst-2' ? { name: 'Fabulously Optimized', versionNumber: '6.1.0', updatable: true } : null,
      80,
    );
  }
  return ipc<ModpackInfo | null>('modpack_info', { id });
}

export function checkModpackUpdate(id: string): Promise<ModpackUpdate | null> {
  if (shouldMock()) {
    return mocked<ModpackUpdate | null>(
      { current: '6.1.0', latest: '6.2.0', versionId: 'v62', publishedAt: new Date().toISOString() },
      500,
    );
  }
  return ipc<ModpackUpdate | null>('check_modpack_update', { id });
}

export function updateModpack(id: string): Promise<ModpackUpdateSummary> {
  if (shouldMock()) return mocked<ModpackUpdateSummary>({ version: '6.2.0', updated: 12, removed: 2, kept: [] }, 900);
  return ipc<ModpackUpdateSummary>('update_modpack', { id });
}
