import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { cn } from '@/lib/cn';
import * as windowApi from '@/api/window';
import { isTauri } from '@/lib/ipc';
import { t } from '@/lib/i18n';

type Light = 'close' | 'minimize' | 'zoom';

const COLOURS: Readonly<Record<Light, string>> = {
  close: 'bg-[#FF5F57]',
  minimize: 'bg-[#FEBC2E]',
  zoom: 'bg-[#28C840]',
};

/** The glyph shows up on hover, the way macOS does it. */
function Glyph({ kind, maximized }: { kind: Light; maximized: boolean }): ReactElement {
  const stroke = 'stroke-black/55';
  switch (kind) {
    case 'close':
      return (
        <svg viewBox="0 0 12 12" className={cn('h-full w-full', stroke)} strokeWidth={1.4} strokeLinecap="round">
          <path d="M4 4l4 4M8 4l-4 4" />
        </svg>
      );
    case 'minimize':
      return (
        <svg viewBox="0 0 12 12" className={cn('h-full w-full', stroke)} strokeWidth={1.4} strokeLinecap="round">
          <path d="M3.5 6h5" />
        </svg>
      );
    case 'zoom':
      return maximized ? (
        <svg viewBox="0 0 12 12" className={cn('h-full w-full', stroke)} strokeWidth={1.3} strokeLinejoin="round">
          <path d="M4.2 7.8h3.6v-3.6z" className="fill-black/55" />
          <path d="M7.8 4.2H4.2v3.6z" fill="none" />
        </svg>
      ) : (
        <svg viewBox="0 0 12 12" className={cn('h-full w-full', stroke)} strokeWidth={1.3} strokeLinejoin="round">
          <path d="M4 8V4h4" className="fill-black/55" />
        </svg>
      );
  }
}

function TrafficLight({
  kind,
  label,
  maximized,
  onClick,
}: {
  kind: Light;
  label: string;
  maximized: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        'group/light h-3 w-3 rounded-pill p-[1px] transition-[filter,transform] duration-fast ease-spring',
        'shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.18)] hover:brightness-105 active:scale-90',
        COLOURS[kind],
        // Unfocused windows go grey on macOS; the group is on the bar.
        'group-data-[blurred=true]/bar:bg-[rgb(var(--text-rgb)/0.22)]',
      )}
    >
      <span className="block h-full w-full opacity-0 transition-opacity duration-fast group-hover/bar:opacity-100">
        <Glyph kind={kind} maximized={maximized} />
      </span>
    </button>
  );
}

/**
 * The window's own title bar: no system frame, three lights on the left and
 * the rest of the strip draggable.
 */
export function TitleBar(): ReactElement {
  const [maximized, setMaximized] = useState(false);
  const [blurred, setBlurred] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    const refresh = (): void => {
      void windowApi.isLauncherMaximized().then((value) => {
        setMaximized(value);
        // The shell rounds its corners unless the window fills the screen.
        document.documentElement.dataset['maximized'] = String(value);
      });
    };
    refresh();
    window.addEventListener('resize', refresh);
    const onBlur = (): void => {
      setBlurred(true);
    };
    const onFocus = (): void => {
      setBlurred(false);
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('resize', refresh);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return (
    <div
      data-tauri-drag-region
      data-blurred={blurred}
      className="group/bar relative z-30 flex h-9 shrink-0 items-center gap-2 px-3.5"
    >
      <TrafficLight
        kind="close"
        label={t`Закрыть`}
        maximized={maximized}
        onClick={() => {
          void windowApi.quitLauncher();
        }}
      />
      <TrafficLight
        kind="minimize"
        label={t`Свернуть`}
        maximized={maximized}
        onClick={() => {
          void windowApi.minimizeLauncher();
        }}
      />
      <TrafficLight
        kind="zoom"
        label={maximized ? t`Вернуть размер` : t`Развернуть`}
        maximized={maximized}
        onClick={() => {
          void windowApi.toggleMaximizeLauncher().then(() => {
            void windowApi.isLauncherMaximized().then((value) => {
              setMaximized(value);
              document.documentElement.dataset['maximized'] = String(value);
            });
          });
        }}
      />
    </div>
  );
}
