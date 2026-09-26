import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { cn } from '@/lib/cn';
import * as instancesApi from '@/api/instances';
import { initialsOf } from '@/lib/format';

/**
 * Icons come out of the jars themselves, so they are the same for every
 * instance that has the same file and worth remembering for the session.
 * `null` means "looked, there is none" and stops the lookup repeating.
 */
const cache = new Map<string, string | null>();

export interface ModIconProps {
  instanceId: string;
  fileName: string;
  /** Shown as initials until an icon turns up, and if none does. */
  name: string;
  className?: string;
}

/** The picture a mod ships inside its jar, read on demand. */
export function ModIcon({ instanceId, fileName, name, className }: ModIconProps): ReactElement {
  const key = `${instanceId}/${fileName}`;
  const [url, setUrl] = useState<string | null>(() => cache.get(key) ?? null);

  useEffect(() => {
    const known = cache.get(key);
    if (known !== undefined) {
      setUrl(known);
      return;
    }
    let alive = true;
    void instancesApi
      .modIcon(instanceId, fileName)
      .then((value) => {
        cache.set(key, value);
        if (alive) setUrl(value);
      })
      .catch(() => {
        // A jar we cannot read is not worth a message; the initials stand in.
        cache.set(key, null);
      });
    return () => {
      alive = false;
    };
  }, [key, instanceId, fileName]);

  const shape = cn('h-9 w-9 shrink-0 rounded-lg', className);

  if (url === null) {
    return (
      <span
        aria-hidden
        className={cn(
          shape,
          'flex items-center justify-center bg-[rgb(var(--text-rgb)/0.07)] text-2xs font-medium text-text-dim',
        )}
      >
        {initialsOf(name)}
      </span>
    );
  }
  return <img src={url} alt="" className={cn(shape, 'object-cover')} />;
}
