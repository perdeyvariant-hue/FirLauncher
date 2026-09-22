export type ThemeMode = 'dark' | 'light' | 'system';

export type WallpaperKind = 'none' | 'mist' | 'dots' | 'forest' | 'custom';
export type MascotKind = 'none' | 'skin' | 'custom' | 'gallery';

/** Personalisation; mirrors `Appearance` in src-tauri/src/config/appearance.rs. */
export interface Appearance {
  /** `#RRGGBB`; hover and pressed shades are derived from it. */
  readonly accent: string;
  readonly wallpaper: WallpaperKind;
  /** Percent, 0–90. */
  readonly wallpaperDim: number;
  /** px, 0–24. */
  readonly wallpaperBlur: number;
  readonly glassPanels: boolean;
  readonly mascot: MascotKind;
  /** Which picture from features/appearance/gallery.ts, for 'gallery'. */
  readonly mascotGalleryId: string;
  /** Which of the user's own pictures, for 'custom'. */
  readonly mascotCustomId: string;
  /** Height in px, 64–320. */
  readonly mascotSize: number;
  /** Percent, 10–100. */
  readonly mascotOpacity: number;
  readonly mascotSide: 'left' | 'right';
  /** Interface zoom, percent, 80–130. */
  readonly uiScale: number;
  /** px, 0–16. */
  readonly radius: number;
  readonly reduceMotion: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = {
  accent: '#8B5CF6',
  wallpaper: 'none',
  wallpaperDim: 55,
  wallpaperBlur: 0,
  glassPanels: true,
  mascot: 'none',
  mascotGalleryId: 'wikipe-tan-classic',
  mascotCustomId: '',
  mascotSize: 150,
  mascotOpacity: 85,
  mascotSide: 'right',
  uiScale: 100,
  radius: 10,
  reduceMotion: false,
};

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
  readonly appearance: Appearance;
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
  appearance: DEFAULT_APPEARANCE,
};
