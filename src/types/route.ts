export const INSTANCE_TABS = [
  'overview',
  'mods',
  'worlds',
  'resourcepacks',
  'shaders',
  'screenshots',
  'logs',
  'settings',
] as const;

export type InstanceTab = (typeof INSTANCE_TABS)[number];

export const INSTANCE_TAB_LABELS: Readonly<Record<InstanceTab, string>> = {
  overview: 'Обзор',
  mods: 'Моды',
  worlds: 'Миры',
  resourcepacks: 'Ресурспаки',
  shaders: 'Шейдеры',
  screenshots: 'Скриншоты',
  logs: 'Логи',
  settings: 'Настройки',
};

export type Route =
  | { readonly name: 'instances' }
  | { readonly name: 'accounts' }
  | { readonly name: 'settings' }
  | { readonly name: 'modpacks' }
  | { readonly name: 'instance'; readonly id: string; readonly tab: InstanceTab };
