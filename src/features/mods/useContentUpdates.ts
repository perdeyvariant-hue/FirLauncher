import { useState } from 'react';
import * as modsApi from '@/api/mods';
import type { ContentKind } from '@/api/mods';
import type { ModUpdate } from '@/types/mod';
import { useToasts } from '@/store/useToasts';

const DONE: Readonly<Record<ContentKind, { none: string; one: string; many: string }>> = {
  mod: { none: 'Все моды актуальны', one: 'Мод обновлён', many: 'Обновлено модов' },
  resourcepack: {
    none: 'Все ресурспаки актуальны',
    one: 'Ресурспак обновлён',
    many: 'Обновлено ресурспаков',
  },
  shader: { none: 'Все шейдеры актуальны', one: 'Шейдер обновлён', many: 'Обновлено шейдеров' },
};

export interface ContentUpdates {
  /** Found updates keyed by the file name on disk. */
  updates: ReadonlyMap<string, ModUpdate>;
  selected: ReadonlySet<string>;
  checking: boolean;
  /** Files being updated right now. */
  updating: ReadonlySet<string>;
  check: () => Promise<void>;
  apply: (list: readonly ModUpdate[]) => Promise<void>;
  setSelected: (fileName: string, on: boolean) => void;
  /** Follows a file that was renamed on disk (mod switched on/off). */
  rename: (from: string, to: string) => void;
  /** Drops a file's update, e.g. after it was removed or replaced. */
  forget: (fileName: string) => void;
}

/** Update check and batch update, shared by the mods and packs tabs. */
export function useContentUpdates(
  instanceId: string,
  kind: ContentKind,
  reload: () => void,
): ContentUpdates {
  const notify = useToasts((store) => store.notify);
  const fail = useToasts((store) => store.fail);

  const [updates, setUpdates] = useState<Map<string, ModUpdate>>(new Map());
  const [selected, setSelectedSet] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState<Set<string>>(new Set());

  const drop = (names: readonly string[]): void => {
    setUpdates((current) => {
      const next = new Map(current);
      for (const name of names) next.delete(name);
      return next;
    });
    setSelectedSet((current) => {
      const next = new Set(current);
      for (const name of names) next.delete(name);
      return next;
    });
  };

  const check = async (): Promise<void> => {
    setChecking(true);
    try {
      const found = await modsApi.checkUpdates(instanceId, kind);
      setUpdates(new Map(found.map((update) => [update.fileName, update])));
      // Everything starts selected; "update selected" is opt-out.
      setSelectedSet(new Set(found.map((update) => update.fileName)));
      notify(
        found.length === 0 ? DONE[kind].none : `Есть обновления: ${String(found.length)}`,
        found.length === 0 ? 'success' : 'info',
      );
      // The check may have identified hand-added files; show their source.
      reload();
    } catch (raw) {
      fail(raw, () => void check());
    }
    setChecking(false);
  };

  const apply = async (list: readonly ModUpdate[]): Promise<void> => {
    if (list.length === 0) return;
    const names = list.map((update) => update.fileName);
    setUpdating((current) => new Set([...current, ...names]));
    try {
      await modsApi.applyUpdates(instanceId, kind, list);
      drop(names);
      notify(
        list.length === 1 ? DONE[kind].one : `${DONE[kind].many}: ${String(list.length)}`,
        'success',
      );
      reload();
    } catch (raw) {
      fail(raw);
    }
    setUpdating((current) => {
      const next = new Set(current);
      for (const name of names) next.delete(name);
      return next;
    });
  };

  const setSelected = (fileName: string, on: boolean): void => {
    setSelectedSet((current) => {
      const next = new Set(current);
      if (on) next.add(fileName);
      else next.delete(fileName);
      return next;
    });
  };

  const rename = (from: string, to: string): void => {
    setUpdates((current) => {
      const update = current.get(from);
      if (update === undefined) return current;
      const next = new Map(current);
      next.delete(from);
      next.set(to, { ...update, fileName: to });
      return next;
    });
    setSelectedSet((current) => {
      if (!current.has(from)) return current;
      const next = new Set(current);
      next.delete(from);
      next.add(to);
      return next;
    });
  };

  return {
    updates,
    selected,
    checking,
    updating,
    check,
    apply,
    setSelected,
    rename,
    forget: (fileName) => {
      drop([fileName]);
    },
  };
}
