import type {
  Category,
  ModProject,
  ModUpdate,
  ModVersion,
  ProjectDetails,
  ProjectKind,
  ProviderId,
  ResolvedInstallPlan,
  SearchQuery,
  SearchResult,
} from '@/types/mod';
import { MOCK_PROJECTS } from '@/mocks/data';
import { ipc, ipcUnit, mocked, shouldMock } from './shared';
import { t } from '@/lib/i18n';

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

/** The full description page of a project. */
export function projectDetails(provider: ProviderId, projectId: string): Promise<ProjectDetails> {
  if (shouldMock()) {
    const project = MOCK_PROJECTS.find((item) => item.projectId === projectId) ?? MOCK_PROJECTS[0];
    if (project === undefined) return Promise.reject(new Error('no fixtures'));
    return mocked<ProjectDetails>(
      {
        project,
        body: [
          `## ${project.name}`,
          '',
          t`${project.summary} Описание из фикстур: **жирный**, *курсив*, \`код\` и [ссылка](https://modrinth.com).`,
          '',
          t`- Первый пункт`,
          t`- Второй пункт`,
          '',
          t`> Цитата автора.`,
          '',
          '<center><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe></center>',
          '',
          '<script>alert(1)</script><img src="x" onerror="alert(2)">',
        ].join('\n'),
        bodyFormat: 'markdown',
        gallery: [],
        links: [
          { kind: 'page', label: '', url: project.pageUrl ?? 'https://modrinth.com' },
          { kind: 'source', label: '', url: 'https://github.com' },
          { kind: 'donation', label: 'Ko-fi', url: 'https://ko-fi.com' },
        ],
        gameVersions: ['1.20.1', '1.20.4', '1.21.1'],
        loaders: ['fabric', 'quilt'],
        publishedAt: '2023-01-01T00:00:00Z',
      },
      300,
    );
  }
  return ipc<ProjectDetails>('project_details', { provider, projectId });
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

/**
 * Versions for the picker, newest first. Only ones that fit the instance
 * unless `anyGameVersion` lifts the Minecraft version filter.
 */
export function listVersions(
  instanceId: string,
  provider: ProviderId,
  projectId: string,
  kind: ContentKind,
  anyGameVersion: boolean,
): Promise<ModVersion[]> {
  if (shouldMock()) {
    const project = MOCK_PROJECTS.find((item) => item.projectId === projectId) ?? MOCK_PROJECTS[0];
    if (project === undefined) return mocked<ModVersion[]>([]);
    const base = mockVersion(project);
    return mocked<ModVersion[]>(
      [
        { ...base, versionId: 'v3', versionNumber: '1.2.0-beta.1', releaseType: 'beta' },
        { ...base, versionId: `${projectId}-v`, versionNumber: '1.1.0' },
        {
          ...base,
          versionId: 'v1',
          versionNumber: '1.0.0',
          gameVersions: anyGameVersion ? ['1.19.4'] : base.gameVersions,
          publishedAt: '2024-03-01T00:00:00Z',
        },
      ],
      300,
    );
  }
  return ipc<ModVersion[]>('list_versions', {
    instanceId,
    provider,
    projectId,
    kind,
    anyGameVersion,
  });
}

/** `versionId` installs that exact version instead of the best fit. */
export function resolveInstall(
  instanceId: string,
  provider: ProviderId,
  projectId: string,
  kind: ContentKind,
  versionId: string | null = null,
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
  return ipc<ResolvedInstallPlan>('resolve_install', {
    instanceId,
    provider,
    projectId,
    kind,
    versionId,
  });
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

export function checkUpdates(instanceId: string, kind: ContentKind): Promise<ModUpdate[]> {
  if (shouldMock()) {
    if (kind !== 'mod') return mocked<ModUpdate[]>([], 500);
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
  return ipc<ModUpdate[]>('check_updates', { instanceId, kind });
}

export function applyUpdates(
  instanceId: string,
  kind: ContentKind,
  updates: readonly ModUpdate[],
): Promise<void> {
  if (shouldMock()) return mocked(undefined, 900);
  return ipcUnit('apply_updates', { instanceId, kind, updates });
}

export interface OptimizeMod {
  readonly projectId: string;
  readonly name: string;
  readonly about: string;
  /** Null when there is no version for this Minecraft version and loader. */
  readonly versionNumber: string | null;
  readonly installed: boolean;
}

export interface OptimizePlan {
  readonly mods: readonly OptimizeMod[];
  readonly currentMemoryMb: number;
  readonly recommendedMemoryMb: number;
  readonly currentJvmArgs: string;
  readonly recommendedJvmArgs: string;
}

export function optimizePlan(instanceId: string): Promise<OptimizePlan> {
  if (shouldMock()) {
    return mocked<OptimizePlan>(
      {
        mods: [
          { projectId: 'AANobbMI', name: 'Sodium', about: t`Новый движок рендера — FPS выше в разы`, versionNumber: '0.6.5', installed: true },
          { projectId: 'gvQqBUqZ', name: 'Lithium', about: t`Быстрее игровая логика: мобы, редстоун, чанки`, versionNumber: '0.14.3', installed: false },
          { projectId: 'uXXizFIs', name: 'FerriteCore', about: t`Заметно меньше расход оперативной памяти`, versionNumber: '7.0.3', installed: false },
          { projectId: 'nmDcB62a', name: 'ModernFix', about: t`Быстрее загрузка игры и миров`, versionNumber: null, installed: false },
        ],
        currentMemoryMb: 4096,
        recommendedMemoryMb: 6144,
        currentJvmArgs: '-XX:+UseG1GC',
        recommendedJvmArgs: '-XX:+UseG1GC -XX:MaxGCPauseMillis=200',
      },
      500,
    );
  }
  return ipc<OptimizePlan>('optimize_plan', { instanceId });
}

export function applyOptimize(
  instanceId: string,
  projectIds: readonly string[],
  memoryMb: number | null,
  jvmArgs: string | null,
): Promise<void> {
  if (shouldMock()) return mocked(undefined, 900);
  return ipcUnit('apply_optimize', { instanceId, projectIds, memoryMb, jvmArgs });
}
