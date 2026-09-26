import type { ReactElement } from 'react';
import { Boxes, Palette, Settings as SettingsIcon, Users } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Logo } from '@/components/ui/Logo';
import { useUI } from '@/store/useUI';
import type { Route } from '@/types/route';
import { AccountCard } from './AccountCard';
import { t } from '@/lib/i18n';

interface NavItem {
  readonly route: Route;
  readonly label: string;
  readonly icon: ReactElement;
}

const NAV: readonly NavItem[] = [
  { route: { name: 'instances' }, label: t`Сборки`, icon: <Boxes size={19} strokeWidth={1.5} /> },
  { route: { name: 'accounts' }, label: t`Аккаунты`, icon: <Users size={19} strokeWidth={1.5} /> },
  { route: { name: 'appearance' }, label: t`Стиль`, icon: <Palette size={19} strokeWidth={1.5} /> },
  {
    route: { name: 'settings' },
    label: t`Настройки`,
    icon: <SettingsIcon size={19} strokeWidth={1.5} />,
  },
];

export function Sidebar(): ReactElement {
  const route = useUI((state) => state.route);
  const navigate = useUI((state) => state.navigate);

  // The instance page still belongs to the "Сборки" section.
  const activeSection: Route['name'] =
    route.name === 'instance' || route.name === 'modpacks' ? 'instances' : route.name;

  return (
    <nav className="glass specular z-20 mb-2.5 ml-2.5 mt-0.5 flex w-[76px] shrink-0 flex-col rounded-2xl">
      <div className="flex h-14 items-center justify-center text-accent">
        <Logo size={22} />
      </div>

      <ul className="flex flex-1 flex-col gap-1 px-2">
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
                  'group relative flex w-full flex-col items-center gap-1 rounded-xl py-2.5',
                  'transition-[background-color,color,box-shadow,transform] duration-fast ease-out',
                  'active:scale-[0.96]',
                  active
                    ? 'bg-accent/[0.18] text-accent shadow-rim'
                    : 'text-text-dim hover:bg-[rgb(var(--text-rgb)/0.07)] hover:text-text',
                )}
              >
                {item.icon}
                <span className="text-2xs font-medium leading-none">{item.label}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <AccountCard />
    </nav>
  );
}
