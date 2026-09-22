import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { cn } from '@/lib/cn';
import { activeAccountOf, useAccounts } from '@/store/useAccounts';
import { useAppearanceImages } from '@/store/useAppearanceImages';
import { useSettings } from '@/store/useSettings';
import type { Appearance } from '@/types/settings';
import { DotsWallpaper, ForestWallpaper, MistWallpaper } from './art';
import { galleryImageUrl, galleryMascot } from './gallery';

function Wallpaper({ appearance }: { appearance: Appearance }): ReactElement | null {
  const custom = useAppearanceImages((state) => state.wallpaper);

  switch (appearance.wallpaper) {
    case 'mist':
      return <MistWallpaper />;
    case 'dots':
      return <DotsWallpaper />;
    case 'forest':
      return <ForestWallpaper />;
    case 'custom': {
      if (custom === null) return null;
      const blur = appearance.wallpaperBlur;
      return (
        <>
          <img
            src={custom}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            // Scaled a little under blur so soft edges stay off-screen.
            style={
              blur > 0 ? { filter: `blur(${String(blur)}px)`, transform: 'scale(1.06)' } : undefined
            }
          />
          <div
            className="absolute inset-0"
            style={{ backgroundColor: `rgb(var(--bg-rgb) / ${String(appearance.wallpaperDim / 100)})` }}
          />
        </>
      );
    }
    case 'none':
      return null;
  }
}

function Mascot({ appearance }: { appearance: Appearance }): ReactElement | null {
  const custom = useAppearanceImages((state) => state.mascots);
  const figure = useAppearanceImages((state) => state.figure);
  const loadFigure = useAppearanceImages((state) => state.loadFigure);
  const account = useAccounts(activeAccountOf);

  const wantsSkin = appearance.mascot === 'skin';
  const accountId = account?.id ?? null;
  const skinUrl = account?.skinUrl ?? null;
  useEffect(() => {
    if (wantsSkin && accountId !== null) void loadFigure(accountId, skinUrl);
  }, [wantsSkin, accountId, skinUrl, loadFigure]);

  let src: string | null = null;
  let pixelated = false;
  switch (appearance.mascot) {
    case 'gallery': {
      const entry = galleryMascot(appearance.mascotGalleryId);
      src = entry === undefined ? null : galleryImageUrl(entry);
      break;
    }
    case 'custom':
      src = custom.find((mascot) => mascot.id === appearance.mascotCustomId)?.url ?? null;
      break;
    case 'skin':
      src = figure?.url ?? null;
      pixelated = true;
      break;
    case 'none':
      break;
  }
  // A missing skin or a deleted picture simply leaves the corner empty.
  if (src === null) return null;

  return (
    <img
      src={src}
      alt=""
      className={cn(
        'pointer-events-none absolute bottom-4 w-auto animate-fade-in select-none object-contain',
        appearance.mascotSide === 'left' ? 'left-6' : 'right-6',
        pixelated ? 'pixelated' : 'drop-shadow-lg',
      )}
      style={{ height: appearance.mascotSize, opacity: appearance.mascotOpacity / 100 }}
    />
  );
}

/** Wallpaper and corner mascot, painted behind the page content. */
export function BackgroundLayer(): ReactElement {
  const appearance = useSettings((state) => state.settings.appearance);
  const loadImages = useAppearanceImages((state) => state.load);

  useEffect(() => {
    void loadImages();
  }, [loadImages]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <Wallpaper appearance={appearance} />
      <Mascot appearance={appearance} />
    </div>
  );
}
