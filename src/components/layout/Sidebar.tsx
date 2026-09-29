import { useState } from 'react';
import type { ReactElement } from 'react';
import { cn } from '@/lib/cn';
import { useUI } from '@/store/useUI';
import type { Route } from '@/types/route';
import { AccountCard } from './AccountCard';
import { t } from '@/lib/i18n';

interface NavItem {
  readonly route: Route;
  readonly label: string;
  readonly icon: ReactElement;
}

const ICON = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

const NAV: readonly NavItem[] = [
  {
    route: { name: 'instances' },
    label: t`Сборки`,
    icon: (
      <svg {...ICON}>
        <rect x="4" y="9" width="16" height="11" rx="3" />
        <path d="M6.5 6h11M9 3h6" />
      </svg>
    ),
  },
  {
    route: { name: 'accounts' },
    label: t`Аккаунты`,
    icon: (
      <svg {...ICON}>
        <circle cx="12" cy="8.5" r="3.8" />
        <path d="M4.5 20c1.2-3.8 4.2-5.5 7.5-5.5s6.3 1.7 7.5 5.5" />
      </svg>
    ),
  },
  {
    route: { name: 'appearance' },
    label: t`Стиль`,
    icon: (
      <svg {...ICON}>
        <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 1.8-1 1.3-2-.6-1.2.2-2.5 1.6-2.5H17a3.5 3.5 0 0 0 3.5-3.5c0-5-3.8-9-8.5-9Z" />
        <circle cx="7.5" cy="11" r="1" />
        <circle cx="10.5" cy="7.3" r="1" />
        <circle cx="15" cy="7.6" r="1" />
      </svg>
    ),
  },
  {
    route: { name: 'settings' },
    label: t`Настройки`,
    icon: (
      <svg {...ICON}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2 5.6 5.6" />
        <circle cx="12" cy="12" r="6.6" />
      </svg>
    ),
  },
];

const ITEM = 62;
const GAP = 6;
const SLOW = '640ms var(--ease-spring)';
const FAST = '340ms var(--ease-spring)';

/** The fir on a plain tile of the accent colour. */
function LogoTile(): ReactElement {
  return (
    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-[16px] bg-accent shadow-[inset_0_1px_0_rgb(255_255_255/0.18)]">
      <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden>
        <path d="M12 2 16.5 8H14l4 5h-3l4.5 6H13v3h-2v-3H4.5L9 13H6l4-5H7.5Z" className="fill-on-accent" />
      </svg>
    </div>
  );
}

export function Sidebar(): ReactElement {
  const route = useUI((state) => state.route);
  const navigate = useUI((state) => state.navigate);

  // The instance page and the modpack catalogue belong to "Сборки".
  const activeSection: Route['name'] =
    route.name === 'instance' || route.name === 'modpacks' ? 'instances' : route.name;
  const index = Math.max(
    0,
    NAV.findIndex((item) => item.route.name === activeSection),
  );

  // The highlight's leading edge moves first, the trailing one catches up.
  const [motion, setMotion] = useState({ index, direction: 1 });
  if (motion.index !== index) setMotion({ index, direction: index > motion.index ? 1 : -1 });
  const down = (motion.index === index ? motion.direction : index > motion.index ? 1 : -1) > 0;
  const step = ITEM + GAP;

  return (
    <nav
      className={cn(
        'glass absolute bottom-[14px] left-[14px] top-[46px] z-20 flex w-[94px] flex-col items-center',
        'rounded-[30px] pb-3.5 pt-4',
      )}
    >
      <LogoTile />

      <div className="relative mt-[22px] w-[78px]" style={{ height: NAV.length * step - GAP }}>
        <div
          aria-hidden
          className="absolute inset-x-0 rounded-[20px] [background:var(--seg)] shadow-[inset_0_0_0_1px_var(--seg-border),inset_0_1px_0_rgb(255_255_255/0.12),0_4px_14px_rgb(0_0_0/0.18)]"
          style={{
            top: index * step,
            bottom: (NAV.length - 1 - index) * step,
            transition: down ? `top ${SLOW}, bottom ${FAST}` : `top ${FAST}, bottom ${SLOW}`,
          }}
        />
        <ul className="relative flex flex-col" style={{ gap: GAP }}>
          {NAV.map((item) => {
            const active = item.route.name === activeSection;
            return (
              <li key={item.route.name}>
                <button
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => {
                    navigate(item.route);
                  }}
                  className={cn(
                    'flex w-full flex-col items-center justify-center gap-[5px] text-[11px] font-semibold',
                    'transition-[color,transform] duration-fast active:scale-[0.94]',
                    active ? 'text-text' : 'text-text-dim hover:text-text',
                  )}
                  style={{ height: ITEM }}
                >
                  {item.icon}
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex-1" />
      <AccountCard />
    </nav>
  );
}
