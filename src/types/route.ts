import { t } from '@/lib/i18n';
export const INSTANCE_TABS = [
  'overview',
  'mods',
  'worlds',
  'servers',
  'resourcepacks',
  'shaders',
  'screenshots',
  'logs',
  'settings',
] as const;

export type InstanceTab = (typeof INSTANCE_TABS)[number];

export const INSTANCE_TAB_LABELS: Readonly<Record<InstanceTab, string>> = {
  overview: t`Обзор`,
  mods: t`Моды`,
  worlds: t`Миры`,
  servers: t`Серверы`,
  resourcepacks: t`Ресурспаки`,
  shaders: t`Шейдеры`,
  screenshots: t`Скриншоты`,
  logs: t`Логи`,
  settings: t`Настройки`,
};

export type Route =
  | { readonly name: 'instances' }
  | { readonly name: 'accounts' }
  | { readonly name: 'settings' }
  | { readonly name: 'appearance' }
  | { readonly name: 'modpacks' }
  | { readonly name: 'instance'; readonly id: string; readonly tab: InstanceTab };
