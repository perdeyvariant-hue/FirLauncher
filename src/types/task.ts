export type TaskState = 'queued' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled';

export type TaskKind =
  | 'install-version'
  | 'install-loader'
  | 'install-java'
  | 'install-mod'
  | 'import-pack'
  | 'export-pack'
  | 'refresh-meta';

export interface Task {
  readonly id: string;
  readonly kind: TaskKind;
  /** e.g. "Fabric 0.16.9 для 1.21.4" */
  readonly title: string;
  /** Current sub-step, e.g. "Библиотеки 42/118". */
  readonly stage: string;
  readonly state: TaskState;
  /** 0..1, or null when the total is not yet known. */
  readonly progress: number | null;
  readonly bytesDone: number;
  readonly bytesTotal: number | null;
  readonly bytesPerSecond: number | null;
  /** Set only when state === 'failed'. */
  readonly error: string | null;
  readonly cancellable: boolean;
  readonly instanceId: string | null;
}
