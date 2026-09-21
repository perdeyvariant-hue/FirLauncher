import type {
  Category,
  ModProject,
  ModUpdate,
  ModVersion,
  ProjectKind,
  ProviderId,
  ResolvedInstallPlan,
  SearchQuery,
  SearchResult,
} from '@/types/mod';
import { MOCK_PROJECTS } from '@/mocks/data';
import { ipc, ipcUnit, mocked, shouldMock } from './shared';

/** Providers the backend considers usable (CurseForge needs an API key). */
export function availableProviders(): Promise<ProviderId[]> {
  if (shouldMock()) return mocked<ProviderId[]>(['modrinth']);
  return ipc<ProviderId[]>('available_providers');
}

export function searchProjects(query: SearchQuery): Promise<SearchResult> {
  if (shouldMock()) {
    const text = query.text.trim().toLowerCase();
    const hits =
      text === ''
        ? MOCK_PROJECTS
        : MOCK_PROJECTS.filter(
            (project) =>
              project.name.toLowerCase().includes(text) ||
              project.summary.toLowerCase().includes(text),
          );
    return mocked<SearchResult>({ hits, totalHits: hits.length, offset: 0 }, 260);
  }
  return ipc<SearchResult>('search_projects', { query });
}

export function listCategories(provider: ProviderId, kind: ProjectKind): Promise<Category[]> {
  if (shouldMock()) {
    return mocked<Category[]>([
      { id: 'optimization', name: 'Optimization' },
      { id: 'utility', name: 'Utility' },
      { id: 'decoration', name: 'Decoration' },
    ]);
  }
  return ipc<Category[]>('list_categories', { provider, kind });
}

/** Content kinds that install into an instance (modpacks create one instead). */
export type ContentKind = Exclude<ProjectKind, 'modpack'>;

export function installedProjects(
  instanceId: string,
  provider: ProviderId,
  kind: ContentKind,
): Promise<string[]> {
  if (shouldMock()) return mocked<string[]>(kind === 'mod' ? ['AANobbMI'] : []);
  return ipc<string[]>('installed_projects', { instanceId, provider, kind });
}

function mockVersion(project: ModProject): ModVersion {
  return {
    provider: project.provider,
    projectId: project.projectId,
    versionId: `${project.projectId}-v`,
    name: project.name,
    versionNumber: '1.0.0',
    fileName: `${project.slug}-1.0.0.jar`,
    sizeBytes: 1_200_000,
    sha1: null,
    downloadUrl: 'https://example.invalid',
    gameVersions: ['1.20.4'],
    loaders: ['fabric'],
    releaseType: 'release',
    publishedAt: new Date().toISOString(),
    dependencies: [],
  };
}

export function resolveInstall(
  instanceId: string,
  provider: ProviderId,
  projectId: string,
  kind: ContentKind,
): Promise<ResolvedInstallPlan> {
  if (shouldMock()) {
    const project = MOCK_PROJECTS.find((item) => item.projectId === projectId) ?? MOCK_PROJECTS[0];
    const api = MOCK_PROJECTS.find((item) => item.slug === 'fabric-api');
    if (project === undefined) return Promise.reject(new Error('no fixtures'));
    const dependencies = api !== undefined && api !== project ? [mockVersion(api)] : [];
    return mocked<ResolvedInstallPlan>(
      {
        primary: mockVersion(project),
        dependencies,
        unresolved: [],
        totalBytes: 1_200_000 * (1 + dependencies.length),
      },
      500,
    );
  }
  return ipc<ResolvedInstallPlan>('resolve_install', { instanceId, provider, projectId, kind });
}

export function installPlan(
  instanceId: string,
  kind: ContentKind,
  plan: ResolvedInstallPlan,
): Promise<void> {
  if (shouldMock()) return mocked(undefined, 900);
  return ipcUnit('install_plan', { instanceId, kind, plan });
}

/** Deletes a resource pack or shader pack (mods go through `removeMod`). */
export function removeContent(
  instanceId: string,
  kind: ContentKind,
  fileName: string,
): Promise<void> {
  if (shouldMock()) return mocked(undefined, 100);
  return ipcUnit('remove_content', { instanceId, kind, fileName });
}

export function checkModUpdates(instanceId: string): Promise<ModUpdate[]> {
  if (shouldMock()) {
    const sodium = MOCK_PROJECTS.find((item) => item.slug === 'sodium');
    if (sodium === undefined) return mocked<ModUpdate[]>([]);
    return mocked<ModUpdate[]>(
      [
        {
          fileName: 'sodium-fabric-0.6.5.jar',
          currentVersion: '0.6.5',
          latest: { ...mockVersion(sodium), versionNumber: '0.6.7' },
        },
      ],
      700,
    );
  }
  return ipc<ModUpdate[]>('check_mod_updates', { instanceId });
}

export function applyModUpdates(instanceId: string, updates: readonly ModUpdate[]): Promise<void> {
  if (shouldMock()) return mocked(undefined, 900);
  return ipcUnit('apply_mod_updates', { instanceId, updates });
}
