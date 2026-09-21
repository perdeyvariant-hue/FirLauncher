export type ThemeMode = 'dark' | 'light' | 'system';

export interface Settings {
  readonly theme: ThemeMode;
  /** Default RAM for new instances, in MiB. */
  readonly defaultMemoryMb: number;
  readonly defaultJvmArgs: string;
  /** Parallel download slots. */
  readonly maxConcurrentDownloads: number;
  /** Empty string means "CurseForge is disabled and hidden in the UI". */
  readonly curseforgeApiKey: string;
  /** Contact appended to the User-Agent, as Modrinth/CurseForge ToS require. */
  readonly contactEmail: string;
  readonly closeLauncherOnLaunch: boolean;
  readonly showSnapshots: boolean;
  /** Overrides the platform default data directory when non-empty. */
  readonly dataDirOverride: string;
  /**
   * Azure application id for Microsoft sign-in. Empty means "use the id the
   * launcher was built with", which may itself be absent.
   */
  readonly msaClientId: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  defaultMemoryMb: 4096,
  defaultJvmArgs: '-XX:+UseG1GC -XX:+UnlockExperimentalVMOptions -XX:G1NewSizePercent=20',
  maxConcurrentDownloads: 16,
  curseforgeApiKey: '',
  contactEmail: '',
  closeLauncherOnLaunch: false,
  showSnapshots: false,
  dataDirOverride: '',
  msaClientId: '',
};
