import { useCallback, useEffect, useState } from 'react';
import type { LauncherError } from '@/types/error';
import { toLauncherError } from './ipc';

export interface AsyncData<T> {
  data: T | null;
  loading: boolean;
  error: LauncherError | null;
  reload: () => void;
}

/**
 * Loads data once per key change, ignores results of superseded calls, and
 * surfaces a normalised error instead of throwing into the render tree.
 */
export function useAsyncData<T>(loader: () => Promise<T>, deps: readonly unknown[]): AsyncData<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LauncherError | null>(null);
  const [nonce, setNonce] = useState(0);

  // The loader identity changes every render; deps are the real trigger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(loader, deps);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    run()
      .then((value) => {
        if (!cancelled) setData(value);
      })
      .catch((raw: unknown) => {
        if (!cancelled) setError(toLauncherError(raw));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [run, nonce]);

  const reload = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  return { data, loading, error, reload };
}
