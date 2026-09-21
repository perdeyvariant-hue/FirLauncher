import type { ReactElement } from 'react';
import { Boxes, Settings as SettingsIcon, Users } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Logo } from '@/components/ui/Logo';
import { useUI } from '@/store/useUI';
import type { Route } from '@/types/route';
import { AccountCard } from './AccountCard';

interface NavItem {
  readonly name: Route['name'];
  readonly label: string;
  readonly icon: ReactElement;
}

const NAV: readonly NavItem[] = [
  { name: 'instances', label: 'Сборки', icon: <Boxes size={19} strokeWidth={1.5} /> },
  { name: 'accounts', label: 'Аккаунты', icon: <Users size={19} strokeWidth={1.5} /> },
  { name: 'settings', label: 'Настройки', icon: <SettingsIcon size={19} strokeWidth={1.5} /> },
];

export function Sidebar(): ReactElement {
  const route = useUI((state) => state.route);
  const navigate = useUI((state) => state.navigate);

  // The instance page still belongs to the "Сборки" section.
  const activeSection: Route['name'] =
    route.name === 'instance' || route.name === 'modpacks' ? 'instances' : route.name;

  return (
    <nav className="flex w-[76px] shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-14 items-center justify-center text-accent">
        <Logo size={22} />
      </div>

      <ul className="flex flex-1 flex-col gap-1 px-2">
        {NAV.map((item) => {
          const active = item.name === activeSection;
          return (
            <li key={item.name}>
              <button
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  navigate(
                    item.name === 'instances'
                      ? { name: 'instances' }
                      : item.name === 'accounts'
                        ? { name: 'accounts' }
                        : { name: 'settings' },
                  );
                }}
                className={cn(
                  'group relative flex w-full flex-col items-center gap-1 rounded-lg py-2.5',
                  'transition-[background-color,color] duration-fast ease-out',
                  active ? 'text-accent' : 'text-text-dim hover:bg-surface-2 hover:text-text',
                )}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-accent" />
                )}
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
