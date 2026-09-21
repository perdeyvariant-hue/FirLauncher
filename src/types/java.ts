export type JavaSource = 'detected' | 'managed' | 'manual';

export interface JavaRuntime {
  readonly path: string;
  /** Major version: 8, 17, 21, … */
  readonly major: number;
  readonly fullVersion: string;
  readonly vendor: string;
  readonly arch: string;
  readonly source: JavaSource;
}

/** Amount of system memory, used to bound the RAM slider. */
export interface SystemMemory {
  readonly totalMb: number;
  readonly availableMb: number;
}
