export type VersionType = 'release' | 'snapshot' | 'old_beta' | 'old_alpha';

/** One entry of Mojang's version_manifest_v2.json, trimmed to what the UI needs. */
export interface MinecraftVersion {
  readonly id: string;
  readonly type: VersionType;
  readonly releasedAt: string;
}

/** A build of a mod loader available for a given Minecraft version. */
export interface LoaderVersion {
  readonly version: string;
  readonly stable: boolean;
  /** Marked by the upstream meta API as the recommended build. */
  readonly recommended: boolean;
}
