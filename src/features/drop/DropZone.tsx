import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Download } from 'lucide-react';
import * as instancesApi from '@/api/instances';
import * as packsApi from '@/api/packs';
import { isTauri } from '@/lib/ipc';
import { useInstances } from '@/store/useInstances';
import { usePacks } from '@/store/usePacks';
import { useToasts } from '@/store/useToasts';
import { useUI } from '@/store/useUI';
import type { Route } from '@/types/route';
import { t } from '@/lib/i18n';

type Action =
  | { readonly type: 'import'; readonly path: string }
  | { readonly type: 'content'; readonly kind: 'mod' | 'resourcepack' | 'shader'; readonly path: string }
  | { readonly type: 'world'; readonly path: string }
  | { readonly type: 'skip'; readonly path: string; readonly reason: string };

function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** What a dropped file becomes, given where the user dropped it. */
function classify(path: string, route: Route): Action {
  const extension = extensionOf(path);
  const onInstance = route.name === 'instance';
  if (extension === 'mrpack') return { type: 'import', path };
  if (extension === 'jar') {
    return onInstance
      ? { type: 'content', kind: 'mod', path }
      : { type: 'skip', path, reason: t`откройте сборку, чтобы добавить в неё мод` };
  }
  if (extension === 'zip') {
    if (onInstance && route.tab === 'resourcepacks') return { type: 'content', kind: 'resourcepack', path };
    if (onInstance && route.tab === 'shaders') return { type: 'content', kind: 'shader', path };
    if (onInstance && route.tab === 'worlds') return { type: 'world', path };
    return { type: 'import', path };
  }
  // No extension: most likely a MultiMC/Prism instance folder.
  if (extension === '') return { type: 'import', path };
  return { type: 'skip', path, reason: t`неизвестный тип файла` };
}

function hint(route: Route, instanceName: string | undefined): string {
  if (route.name !== 'instance') {
    return t`Модпак (.mrpack, .zip) или папка MultiMC/Prism станет новой сборкой`;
  }
  const target = instanceName === undefined ? t`сборку` : `«${instanceName}»`;
  switch (route.tab) {
    case 'resourcepacks':
      return t`.zip — ресурспак в ${target}, .jar — мод, .mrpack — новая сборка`;
    case 'shaders':
      return t`.zip — шейдер в ${target}, .jar — мод, .mrpack — новая сборка`;
    case 'worlds':
      return t`.zip — мир в ${target}, .jar — мод, .mrpack — новая сборка`;
    default:
      return t`.jar — мод в ${target}, .mrpack или .zip — новая сборка`;
  }
}

/**
 * Files dropped anywhere on the window: packs become instances, jars go into
 * the open instance's mods, zips into the open tab's folder.
 */
export function DropZone(): ReactElement | null {
  const [dragging, setDragging] = useState(false);
  const route = useUI((state) => state.route);
  const instanceName = useInstances((state) =>
    route.name === 'instance' ? state.instances.find((item) => item.id === route.id)?.name : undefined,
  );

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;

    const handleDrop = async (paths: readonly string[]): Promise<void> => {
      const current = useUI.getState().route;
      const toasts = useToasts.getState();
      let added = 0;
      for (const path of paths) {
        const action = classify(path, current);
        try {
          switch (action.type) {
            case 'import':
              usePacks.getState().finishImport(await packsApi.importPack(action.path));
              break;
            case 'content':
              if (current.name === 'instance') {
                await instancesApi.addContentFile(current.id, action.kind, action.path);
                added += 1;
              }
              break;
            case 'world':
              if (current.name === 'instance') {
                const name = await instancesApi.importWorld(current.id, action.path);
                toasts.notify(t`Мир «${name}» добавлен`, 'success');
                added += 1;
              }
              break;
            case 'skip':
              toasts.notify(`${action.path.split(/[\\/]/).pop() ?? action.path}: ${action.reason}`, 'error');
              break;
          }
        } catch (raw) {
          toasts.fail(raw);
        }
      }
      if (added > 0) {
        useUI.getState().bumpContent();
        if (added > 1 || current.name !== 'instance' || current.tab !== 'worlds') {
          toasts.notify(t`Добавлено файлов: ${String(added)}`, 'success');
        }
      }
    };

    void import('@tauri-apps/api/webview')
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === 'enter' || payload.type === 'over') setDragging(true);
          else if (payload.type === 'leave') setDragging(false);
          else {
            setDragging(false);
            void handleDrop(payload.paths);
          }
        }),
      )
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        // Without drag-and-drop support the rest of the launcher still works.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  if (!dragging) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex animate-fade-in items-center justify-center bg-[var(--overlay)] p-10">
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-accent bg-accent/5">
        <Download size={32} strokeWidth={1.5} className="text-accent" />
        <p className="text-sm font-semibold text-text">{t`Отпустите, чтобы добавить`}</p>
        <p className="max-w-[420px] text-center text-xs text-text-dim">{hint(route, instanceName)}</p>
      </div>
    </div>
  );
}
