import { t } from '@/lib/i18n';
/**
 * Freely licensed anime mascots shipped in public/mascots. Each entry carries
 * what CC BY-SA asks for — author, licence and a link to the original — and
 * the appearance page shows it under the selected picture.
 * Keep in sync with public/mascots/CREDITS.md.
 */
export interface GalleryMascot {
  /** Stored in settings as `mascotGalleryId`. */
  readonly id: string;
  readonly name: string;
  readonly author: string;
  readonly license: 'CC BY-SA 3.0' | 'CC BY-SA 4.0';
  /** The file page on Wikimedia Commons. */
  readonly source: string;
}

export const GALLERY: readonly GalleryMascot[] = [
  {
    id: 'wikipe-tan-classic',
    name: 'Wikipe-tan',
    author: 'Kasuga',
    license: 'CC BY-SA 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:Wikipe-tan_full_length.png',
  },
  {
    id: 'wikipe-tan-sailor',
    name: t`В матроске`,
    author: 'Kasuga',
    license: 'CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Wikipe-tan_sailor_fuku.png',
  },
  {
    id: 'wikipe-tan-casual',
    name: t`На каждый день`,
    author: 'Kasuga',
    license: 'CC BY-SA 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:Wikipe_tan_casual.png',
  },
  {
    id: 'wikipe-tan-conductor',
    name: t`Дирижёр`,
    author: 'Kasuga',
    license: 'CC BY-SA 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:Wikipe-tan_conducting.png',
  },
  {
    id: 'wikipe-tan-halloween',
    name: t`Хеллоуин`,
    author: 'Kasuga',
    license: 'CC BY-SA 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:Wikipe-tan_dressed_in_a_Halloween_costume.png',
  },
  {
    id: 'wikipe-tan-cleopatra',
    name: t`Клеопатра`,
    author: 'Kasuga',
    license: 'CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Wikipe-tan_in_Cleopatra-style_costume.png',
  },
  {
    id: 'wikipe-tan-astronaut',
    name: t`Астронавт`,
    author: 'Di (they-them)',
    license: 'CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Wikipe-tan_astronaut.png',
  },
  {
    id: 'wikipe-tan-dress',
    name: t`В платье`,
    author: 'Seb.cestari.16',
    license: 'CC BY-SA 4.0',
    source: 'https://commons.wikimedia.org/wiki/File:Wikipe-tan_con_vestido_venezolano.png',
  },
  {
    id: 'huijun-chan',
    name: 'Huijun-chan',
    author: t`Thyj, дизайн персонажа — 今天你高兴吗`,
    license: 'CC BY-SA 3.0',
    source: 'https://commons.wikimedia.org/wiki/File:Huijun-chan_full_length.png',
  },
];

export const LICENSE_URLS: Readonly<Record<GalleryMascot['license'], string>> = {
  'CC BY-SA 3.0': 'https://creativecommons.org/licenses/by-sa/3.0/',
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
};

export function galleryMascot(id: string): GalleryMascot | undefined {
  return GALLERY.find((entry) => entry.id === id);
}

/** Served from public/mascots, both in dev and in the packaged app. */
export function galleryImageUrl(entry: GalleryMascot): string {
  return `/mascots/${entry.id}.png`;
}
