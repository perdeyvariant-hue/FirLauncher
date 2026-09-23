export type AccountKind = 'microsoft' | 'offline';

export interface Account {
  readonly id: string;
  readonly kind: AccountKind;
  readonly username: string;
  /** Offline accounts get a deterministic offline UUID. */
  readonly uuid: string;
  /** URL or data URL of the rendered skin head; null while loading. */
  readonly avatarUrl: string | null;
  readonly skinUrl: string | null;
  /** Microsoft accounts only: whether the cached token is still usable. */
  readonly expired: boolean;
  readonly addedAt: string;
}

/** Progress of the Microsoft sign-in, driven from the backend. */
export type LoginState =
  | { readonly phase: 'waiting' }
  | { readonly phase: 'cancelled' }
  | { readonly phase: 'exchanging'; readonly step: 'xbox' | 'xsts' | 'minecraft' | 'profile' }
  | { readonly phase: 'done'; readonly accountId: string }
  | { readonly phase: 'failed'; readonly message: string };
