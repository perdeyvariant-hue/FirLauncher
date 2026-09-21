import type { ModLoader } from './instance';

/** Identifier of a `ModProvider` implementation on the Rust side. */
export type ProviderId = 'modrinth' | 'curseforge';

export const PROVIDER_LABELS: Readonly<Record<ProviderId, string>> = {
  modrinth: 'Modrinth',
  curseforge: 'CurseForge',
};

export type ProjectKind = 'mod' | 'modpack' | 'resourcepack' | 'shader';

export interface ModProject {
  readonly provider: ProviderId;
  readonly projectId: string;
  readonly slug: string;
  readonly name: string;
  readonly summary: string;
  readonly author: string;
  readonly iconUrl: string | null;
  readonly downloads: number;
  readonly followers: number | null;
  readonly categories: readonly string[];
  readonly kind: ProjectKind;
  readonly updatedAt: string | null;
  readonly license: string | null;
  /** The project's page, for files that cannot be fetched automatically. */
  readonly pageUrl: string | null;
}

export interface Category {
  /** What the provider's search filter expects. */
  readonly id: string;
  readonly name: string;
}

export type DependencyKind = 'required' | 'optional' | 'incompatible' | 'embedded';

export interface ModDependency {
  readonly provider: ProviderId;
  readonly projectId: string;
  readonly versionId: string | null;
  readonly kind: DependencyKind;
  /** Filled by the backend when it resolves the dependency graph. */
  readonly name: string | null;
}

export interface ModVersion {
  readonly provider: ProviderId;
  readonly projectId: string;
  readonly versionId: string;
  readonly name: string;
  readonly versionNumber: string;
  readonly fileName: string;
  readonly sizeBytes: number;
  readonly sha1: string | null;
  readonly downloadUrl: string;
  readonly gameVersions: readonly string[];
  readonly loaders: readonly ModLoader[];
  readonly releaseType: 'release' | 'beta' | 'alpha';
  readonly publishedAt: string;
  readonly dependencies: readonly ModDependency[];
}

export interface SearchQuery {
  readonly provider: ProviderId;
  readonly text: string;
  readonly kind: ProjectKind;
  readonly gameVersion: string | null;
  readonly loader: ModLoader | null;
  readonly categories: readonly string[];
  readonly sort: 'relevance' | 'downloads' | 'follows' | 'updated' | 'newest';
  readonly offset: number;
  readonly limit: number;
}

export interface SearchResult {
  readonly hits: readonly ModProject[];
  readonly totalHits: number;
  readonly offset: number;
}

/** One line of the confirmation dialog shown before a multi-file install. */
export interface ResolvedInstallPlan {
  readonly primary: ModVersion;
  readonly dependencies: readonly ModVersion[];
  /** Dependencies that could not be resolved automatically. */
  readonly unresolved: readonly ModDependency[];
  readonly totalBytes: number;
}

/** An installed file with a newer compatible version available. */
export interface ModUpdate {
  /** As it is on disk now, `.disabled` included. */
  readonly fileName: string;
  readonly currentVersion: string | null;
  readonly latest: ModVersion;
}
