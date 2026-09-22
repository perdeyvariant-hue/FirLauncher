import { ipc, ipcUnit, mocked, shouldMock } from './shared';

/** Where a single custom picture goes. */
export type ImageSlot = 'wallpaper';

/** One of the user's own mascot pictures. */
export interface CustomMascot {
  readonly id: string;
  /** A `data:` URL. */
  readonly url: string;
}

/** Opens a file picker for a picture; null when cancelled. */
export async function pickImage(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({
    multiple: false,
    filters: [{ name: 'Изображение', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
  });
  return typeof picked === 'string' ? picked : null;
}

/** Copies the picture into the launcher's data folder; returns a data URL. */
export function setAppearanceImage(slot: ImageSlot, path: string): Promise<string> {
  if (shouldMock()) return Promise.reject(new Error('Выбор файла доступен только в приложении'));
  return ipc<string>('set_appearance_image', { slot, path });
}

export function appearanceImage(slot: ImageSlot): Promise<string | null> {
  if (shouldMock()) return mocked<string | null>(null, 50);
  return ipc<string | null>('appearance_image', { slot });
}

export function clearAppearanceImage(slot: ImageSlot): Promise<void> {
  if (shouldMock()) return mocked(undefined, 50);
  return ipcUnit('clear_appearance_image', { slot });
}

export function listCustomMascots(): Promise<CustomMascot[]> {
  if (shouldMock()) return mocked<CustomMascot[]>([], 50);
  return ipc<CustomMascot[]>('list_custom_mascots');
}

/** Copies a picture into the collection. */
export function addCustomMascot(path: string): Promise<CustomMascot> {
  if (shouldMock()) return Promise.reject(new Error('Выбор файла доступен только в приложении'));
  return ipc<CustomMascot>('add_custom_mascot', { path });
}

export function removeCustomMascot(id: string): Promise<void> {
  if (shouldMock()) return mocked(undefined, 50);
  return ipcUnit('remove_custom_mascot', { id });
}

/** The account's skin drawn full-length; null without a skin (offline). */
export function accountFigure(accountId: string): Promise<string | null> {
  if (shouldMock()) return mocked<string | null>(null, 50);
  return ipc<string | null>('account_figure', { accountId });
}
