/** Mirrors `CrashFix` in src-tauri/src/minecraft/crash.rs. */
export type CrashFix =
  | { readonly type: 'installMods'; readonly modIds: readonly string[] }
  | { readonly type: 'useJava'; readonly major: number }
  | { readonly type: 'setMemory'; readonly memoryMb: number }
  | { readonly type: 'disableMods'; readonly modIds: readonly string[] };

export interface Diagnosis {
  readonly rule: string;
  readonly title: string;
  readonly explanation: string;
  readonly fix: CrashFix | null;
}

export interface CrashAnalysis {
  readonly diagnoses: readonly Diagnosis[];
  /** First error lines, for when no rule matched. */
  readonly excerpt: readonly string[];
  readonly exitCode: number | null;
  readonly crashReport: string | null;
}
