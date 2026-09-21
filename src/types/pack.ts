import type { Instance } from './instance';

/** A file a pack wanted that could not be installed automatically. */
export interface SkippedFile {
  readonly name: string;
  /** Where to get it by hand, when known. */
  readonly url: string | null;
  readonly reason: string;
}

export interface ImportResult {
  readonly instance: Instance;
  readonly skipped: readonly SkippedFile[];
}

export type ExportFormat = 'mrpack' | 'zip';

export interface ExportSummary {
  /** Files referenced by URL in the pack. */
  readonly linked: number;
  /** Files copied into the archive. */
  readonly embedded: number;
  readonly bytes: number;
}
