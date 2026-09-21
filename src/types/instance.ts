export const MOD_LOADERS = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'] as const;
export type ModLoader = (typeof MOD_LOADERS)[number];

export const LOADER_LABELS: Readonly<Record<ModLoader, string>> = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
};

export type InstanceStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'installing'; readonly taskId: string }
  | { readonly state: 'running'; readonly pid: number }
  | { readonly state: 'crashed'; readonly exitCode: number };

export interface WindowSize {
  readonly width: number;
  readonly height: number;
  readonly fullscreen: boolean;
}

/** Per-instance overrides. `null` means "inherit the global setting". */
export interface InstanceJavaSettings {
  /** Absolute path to a java executable, or null for auto-selection. */
  readonly javaPath: string | null;
  readonly memoryMb: number | null;
  readonly extraJvmArgs: string | null;
  readonly window: WindowSize | null;
  readonly env: Readonly<Record<string, string>>;
}

export interface Instance {
  readonly id: string;
  readonly name: string;
  /** Data URL or file path resolved by the backend; null → generated initial. */
  readonly iconPath: string | null;
  readonly mcVersion: string;
  readonly loader: ModLoader;
  readonly loaderVersion: string | null;
  readonly createdAt: string;
  readonly lastPlayedAt: string | null;
  /** Total playtime in seconds. */
  readonly totalPlaySeconds: number;
  readonly group: string | null;
  readonly java: InstanceJavaSettings;
  readonly status: InstanceStatus;
}

export interface InstalledMod {
  readonly fileName: string;
  readonly name: string;
  readonly version: string | null;
  readonly author: string | null;
  readonly enabled: boolean;
  readonly sizeBytes: number;
  /** Hashing every jar on open is too slow for big packs; filled on demand. */
  readonly sha1: string | null;
  /** Set when the file was installed from a known provider. */
  readonly source: { readonly provider: string; readonly projectId: string } | null;
  readonly updateAvailable: string | null;
}

export interface WorldEntry {
  readonly folderName: string;
  readonly name: string;
  readonly lastPlayedAt: string | null;
  readonly sizeBytes: number;
  readonly gameMode: string | null;
}

export interface ResourcePackEntry {
  readonly fileName: string;
  readonly name: string;
  readonly description: string | null;
  readonly sizeBytes: number;
  readonly packFormat: number | null;
}

export interface ScreenshotEntry {
  readonly fileName: string;
  readonly takenAt: string;
  readonly sizeBytes: number;
}

export type LogStream = 'stdout' | 'stderr' | 'launcher';

export interface LogLine {
  readonly seq: number;
  readonly stream: LogStream;
  readonly text: string;
}
