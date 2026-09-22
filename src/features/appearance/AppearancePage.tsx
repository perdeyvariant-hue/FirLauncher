import { useMemo } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import {
  AlertTriangle,
  Ban,
  Check,
  ExternalLink,
  ImagePlus,
  Pipette,
  RotateCcw,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Section } from '@/components/ui/Section';
import { Slider } from '@/components/ui/Slider';
import { Switch } from '@/components/ui/Switch';
import { accentPalette, contrastRatio, luminance, parseHex, toChannels } from '@/lib/color';
import { resolveTheme } from '@/lib/appearance';
import { openExternal } from '@/api/system';
import { activeAccountOf, useAccounts } from '@/store/useAccounts';
import { useAppearanceImages } from '@/store/useAppearanceImages';
import { useSettings } from '@/store/useSettings';
import type { Appearance, MascotKind, ThemeMode, WallpaperKind } from '@/types/settings';
import { DEFAULT_APPEARANCE } from '@/types/settings';
import {
  DotsWallpaper,
  ForestWallpaper,
  MistWallpaper,
} from './art';
import { GALLERY, LICENSE_URLS, galleryImageUrl, galleryMascot } from './gallery';

const ACCENTS: readonly { readonly hex: string; readonly name: string }[] = [
  { hex: '#8B5CF6', name: 'Фиолетовый' },
  { hex: '#3B82F6', name: 'Синий' },
  { hex: '#0EA5E9', name: 'Голубой' },
  { hex: '#14B8A6', name: 'Бирюзовый' },
  { hex: '#22C55E', name: 'Зелёный' },
  { hex: '#EAB308', name: 'Жёлтый' },
  { hex: '#F97316', name: 'Оранжевый' },
  { hex: '#EF4444', name: 'Красный' },
  { hex: '#EC4899', name: 'Розовый' },
  { hex: '#A1A1AA', name: 'Графит' },
];

interface Preset {
  readonly name: string;
  readonly accent: string;
  readonly wallpaper: WallpaperKind;
  readonly mascot: MascotKind;
  readonly galleryId?: string;
}

/** One-click looks; they touch colour, wallpaper and mascot only. */
const PRESETS: readonly Preset[] = [
  { name: 'Фиолетовая ночь', accent: '#8B5CF6', wallpaper: 'mist', mascot: 'none' },
  {
    name: 'Хвойный лес',
    accent: '#22C55E',
    wallpaper: 'forest',
    mascot: 'gallery',
    galleryId: 'wikipe-tan-casual',
  },
  { name: 'Океан', accent: '#0EA5E9', wallpaper: 'mist', mascot: 'none' },
  {
    name: 'Хеллоуин',
    accent: '#F97316',
    wallpaper: 'forest',
    mascot: 'gallery',
    galleryId: 'wikipe-tan-halloween',
  },
  {
    name: 'Сакура',
    accent: '#EC4899',
    wallpaper: 'dots',
    mascot: 'gallery',
    galleryId: 'wikipe-tan-dress',
  },
  {
    name: 'Википе-тан',
    accent: '#60A5FA',
    wallpaper: 'mist',
    mascot: 'gallery',
    galleryId: 'wikipe-tan-classic',
  },
  {
    name: 'Космос',
    accent: '#6366F1',
    wallpaper: 'dots',
    mascot: 'gallery',
    galleryId: 'wikipe-tan-astronaut',
  },
  { name: 'Монохром', accent: '#A1A1AA', wallpaper: 'none', mascot: 'none' },
];

const THEMES: readonly { readonly value: ThemeMode; readonly label: string }[] = [
  { value: 'dark', label: 'Тёмная' },
  { value: 'light', label: 'Светлая' },
  { value: 'system', label: 'Как в системе' },
];

/**
 * CSS variables that recolour whatever is inside — used to preview a preset
 * in its own accent without touching the rest of the page.
 */
function accentScope(hex: string, theme: 'dark' | 'light'): CSSProperties {
  const base = parseHex(hex);
  if (base === null) return {};
  const palette = accentPalette(base, theme);
  return {
    '--accent-rgb': toChannels(palette.accent),
    '--accent-hover-rgb': toChannels(palette.hover),
    '--accent-dim-rgb': toChannels(palette.dim),
  } as CSSProperties;
}

/** A tick that stays visible on both pale and deep swatches. */
function checkColor(hex: string): string {
  const color = parseHex(hex);
  return color !== null && luminance(color) > 0.36 ? '#18181B' : '#FFFFFF';
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { readonly value: T; readonly label: string }[];
  onChange: (value: T) => void;
}): ReactElement {
  return (
    <div role="radiogroup" className="flex w-fit rounded-lg border border-border bg-surface-2 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => {
            onChange(option.value);
          }}
          className={cn(
            'h-7 rounded-md px-3 text-xs font-medium transition-colors duration-fast ease-out',
            option.value === value ? 'bg-accent text-on-accent' : 'text-text-dim hover:text-text',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** A selectable card with a live preview on top and a caption below. */
function Tile({
  selected,
  label,
  onSelect,
  children,
  previewStyle,
}: {
  selected: boolean;
  label: string;
  onSelect: () => void;
  children: ReactNode;
  previewStyle?: CSSProperties;
}): ReactElement {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'group flex flex-col overflow-hidden rounded-lg border text-left',
        'transition-colors duration-fast ease-out',
        selected ? 'border-accent' : 'border-border hover:border-text-dim',
      )}
    >
      <div className="relative h-20 overflow-hidden bg-bg" style={previewStyle}>
        {children}
      </div>
      <div className="flex items-center gap-1.5 border-t border-border bg-surface px-2.5 py-1.5">
        <span className={cn('truncate text-2xs font-medium', selected ? 'text-accent' : 'text-text')}>
          {label}
        </span>
        {selected && <Check size={12} strokeWidth={2} className="ml-auto shrink-0 text-accent" />}
      </div>
    </button>
  );
}

function Centered({ children }: { children: ReactNode }): ReactElement {
  return <div className="flex h-full items-center justify-center text-text-dim">{children}</div>;
}

function MascotPreview({
  kind,
  custom,
  figure,
  galleryId = 'wikipe-tan-classic',
}: {
  kind: MascotKind;
  custom: string | null;
  figure: string | null;
  galleryId?: string;
}): ReactElement {
  switch (kind) {
    case 'gallery': {
      const entry = galleryMascot(galleryId) ?? GALLERY[0];
      return (
        <Centered>
          {entry !== undefined && (
            <img src={galleryImageUrl(entry)} alt="" className="h-16 w-auto object-contain" />
          )}
        </Centered>
      );
    }
    case 'none':
      return (
        <Centered>
          <Ban size={18} strokeWidth={1.5} />
        </Centered>
      );
    case 'skin':
      return (
        <Centered>
          {figure === null ? (
            <User size={20} strokeWidth={1.5} />
          ) : (
            <img src={figure} alt="" className="pixelated h-16 w-auto" />
          )}
        </Centered>
      );
    case 'custom':
      return (
        <Centered>
          {custom === null ? (
            <ImagePlus size={20} strokeWidth={1.5} />
          ) : (
            <img src={custom} alt="" className="h-16 w-auto object-contain" />
          )}
        </Centered>
      );
  }
}

function WallpaperPreview({ kind, custom }: { kind: WallpaperKind; custom: string | null }): ReactElement {
  switch (kind) {
    case 'none':
      return (
        <Centered>
          <Ban size={18} strokeWidth={1.5} />
        </Centered>
      );
    case 'mist':
      return <MistWallpaper />;
    case 'dots':
      return <DotsWallpaper />;
    case 'forest':
      return <ForestWallpaper />;
    case 'custom':
      return custom === null ? (
        <Centered>
          <ImagePlus size={20} strokeWidth={1.5} />
        </Centered>
      ) : (
        <img src={custom} alt="" className="absolute inset-0 h-full w-full object-cover" />
      );
  }
}

const WALLPAPERS: readonly { readonly kind: WallpaperKind; readonly label: string }[] = [
  { kind: 'none', label: 'Без обоев' },
  { kind: 'mist', label: 'Туман' },
  { kind: 'dots', label: 'Точки' },
  { kind: 'forest', label: 'Хвойный лес' },
  { kind: 'custom', label: 'Своё изображение' },
];

const MASCOTS: readonly { readonly kind: MascotKind; readonly label: string }[] = [
  { kind: 'none', label: 'Без талисмана' },
  { kind: 'skin', label: 'Мой скин' },
];

/** A picture button in the mascot grids, optionally removable. */
function PictureChoice({
  src,
  label,
  selected,
  onSelect,
  onRemove,
}: {
  src: string;
  label: string;
  selected: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}): ReactElement {
  return (
    <div className="group relative">
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        title={label}
        onClick={onSelect}
        className={cn(
          'flex h-24 w-full items-end justify-center overflow-hidden rounded-lg border bg-bg pt-1',
          'transition-colors duration-fast ease-out',
          selected ? 'border-accent bg-accent/10' : 'border-border hover:border-text-dim',
        )}
      >
        <img src={src} alt={label} loading="lazy" className="h-full w-auto object-contain" />
      </button>
      {onRemove !== undefined && (
        <button
          type="button"
          aria-label={`Удалить: ${label}`}
          title="Удалить"
          onClick={onRemove}
          className={cn(
            'absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md',
            'bg-surface/90 text-text-dim opacity-0 transition-opacity duration-fast ease-out',
            'hover:text-danger focus-visible:opacity-100 group-hover:opacity-100',
          )}
        >
          <X size={13} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}

export function AppearancePage(): ReactElement {
  const themeMode = useSettings((state) => state.settings.theme);
  const appearance = useSettings((state) => state.settings.appearance);
  const patch = useSettings((state) => state.patch);
  const patchAppearance = useSettings((state) => state.patchAppearance);
  const wallpaperImage = useAppearanceImages((state) => state.wallpaper);
  const mascots = useAppearanceImages((state) => state.mascots);
  const figure = useAppearanceImages((state) => state.figure?.url ?? null);
  const chooseWallpaper = useAppearanceImages((state) => state.chooseWallpaper);
  const clearWallpaper = useAppearanceImages((state) => state.clearWallpaper);
  const addMascot = useAppearanceImages((state) => state.addMascot);
  const removeMascot = useAppearanceImages((state) => state.removeMascot);
  const account = useAccounts(activeAccountOf);

  const theme = resolveTheme(themeMode);
  const selectedGallery =
    appearance.mascot === 'gallery' ? galleryMascot(appearance.mascotGalleryId) : undefined;
  const set = (next: Partial<Appearance>): void => {
    patchAppearance(next);
  };

  const accent = appearance.accent.toUpperCase();
  const lowContrast = useMemo(() => {
    const color = parseHex(accent);
    if (color === null) return false;
    const background = theme === 'dark' ? { r: 10, g: 10, b: 11 } : { r: 255, g: 255, b: 255 };
    return contrastRatio(color, background) < 2.2;
  }, [accent, theme]);

  const pickWallpaper = async (): Promise<void> => {
    if (await chooseWallpaper()) set({ wallpaper: 'custom' });
  };
  const pickMascot = async (): Promise<void> => {
    const added = await addMascot();
    if (added !== null) set({ mascot: 'custom', mascotCustomId: added.id });
  };
  const dropMascot = (id: string): void => {
    if (appearance.mascot === 'custom' && appearance.mascotCustomId === id) {
      set({ mascot: 'none', mascotCustomId: '' });
    }
    void removeMascot(id);
  };

  return (
    <div className="flex h-full flex-col">
      <header className="hairline-b flex h-14 shrink-0 items-center gap-3 px-6">
        <h1 className="text-sm font-semibold text-text">Оформление</h1>
        <div className="ml-auto">
          <Button
            size="sm"
            variant="ghost"
            icon={<RotateCcw size={13} strokeWidth={1.5} />}
            onClick={() => {
              void patch({ appearance: DEFAULT_APPEARANCE });
            }}
          >
            Сбросить всё
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="flex max-w-[820px] flex-col gap-3">
          <Section title="Готовые темы" description="Цвет, обои и талисман одним нажатием.">
            <div role="radiogroup" className="grid grid-cols-4 gap-2">
              {PRESETS.map((preset) => {
                const selected =
                  preset.accent === accent &&
                  preset.wallpaper === appearance.wallpaper &&
                  preset.mascot === appearance.mascot &&
                  (preset.galleryId === undefined ||
                    preset.galleryId === appearance.mascotGalleryId);
                return (
                  <Tile
                    key={preset.name}
                    label={preset.name}
                    selected={selected}
                    previewStyle={accentScope(preset.accent, theme)}
                    onSelect={() => {
                      set({
                        accent: preset.accent,
                        wallpaper: preset.wallpaper,
                        mascot: preset.mascot,
                        ...(preset.galleryId === undefined
                          ? {}
                          : { mascotGalleryId: preset.galleryId }),
                      });
                    }}
                  >
                    <WallpaperPreview kind={preset.wallpaper} custom={null} />
                    {preset.wallpaper === 'none' && (
                      <div className="absolute inset-0 bg-bg" />
                    )}
                    <div className="absolute left-2.5 top-2.5 flex flex-col gap-1">
                      <span className="h-1.5 w-12 rounded-full bg-accent" />
                      <span className="h-1.5 w-8 rounded-full bg-text-dim/40" />
                    </div>
                    {preset.mascot !== 'none' && (
                      <div className="absolute bottom-1 right-2">
                        <MascotPreview
                          kind={preset.mascot}
                          custom={null}
                          figure={null}
                          galleryId={preset.galleryId}
                        />
                      </div>
                    )}
                  </Tile>
                );
              })}
            </div>
          </Section>

          <Section title="Тема и цвет">
            <Segmented
              value={themeMode}
              options={THEMES}
              onChange={(value) => {
                void patch({ theme: value });
              }}
            />

            <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Цвет акцента">
              {ACCENTS.map((swatch) => (
                <button
                  key={swatch.hex}
                  type="button"
                  role="radio"
                  aria-checked={swatch.hex === accent}
                  title={swatch.name}
                  onClick={() => {
                    set({ accent: swatch.hex });
                  }}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full ring-offset-2 ring-offset-surface',
                    'transition-transform duration-fast ease-out hover:scale-110',
                    swatch.hex === accent && 'ring-2 ring-text',
                  )}
                  style={{ backgroundColor: swatch.hex }}
                >
                  {swatch.hex === accent && (
                    <Check size={14} strokeWidth={2.5} style={{ color: checkColor(swatch.hex) }} />
                  )}
                </button>
              ))}

              <label
                title="Свой цвет"
                className={cn(
                  'relative flex h-8 cursor-pointer items-center gap-2 rounded-full border border-border px-2.5',
                  'text-2xs text-text-dim transition-colors duration-fast ease-out hover:border-text-dim',
                  !ACCENTS.some((swatch) => swatch.hex === accent) && 'border-accent text-text',
                )}
              >
                <span className="h-4 w-4 rounded-full" style={{ backgroundColor: accent }} />
                <Pipette size={13} strokeWidth={1.5} />
                <span className="font-mono">{accent}</span>
                <input
                  type="color"
                  value={accent.toLowerCase()}
                  onChange={(event) => {
                    set({ accent: event.target.value.toUpperCase() });
                  }}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label="Свой цвет акцента"
                />
              </label>
            </div>

            {lowContrast && (
              <p className="flex items-center gap-2 text-2xs text-danger">
                <AlertTriangle size={13} strokeWidth={1.5} />
                Этот цвет плохо виден на {theme === 'dark' ? 'тёмном' : 'светлом'} фоне.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary">
                Так выглядит кнопка
              </Button>
              <span className="text-xs text-accent">и ссылка</span>
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-2">
                <span className="block h-full w-2/3 rounded-full bg-accent" />
              </span>
            </div>
          </Section>

          <Section
            title="Обои"
            description="Рисуются за содержимым страниц. Свои картинки хранятся в папке данных лаунчера."
          >
            <div role="radiogroup" className="grid grid-cols-5 gap-2">
              {WALLPAPERS.map((option) => (
                <Tile
                  key={option.kind}
                  label={option.label}
                  selected={appearance.wallpaper === option.kind}
                  onSelect={() => {
                    if (option.kind === 'custom' && wallpaperImage === null) void pickWallpaper();
                    else set({ wallpaper: option.kind });
                  }}
                >
                  <WallpaperPreview kind={option.kind} custom={wallpaperImage} />
                </Tile>
              ))}
            </div>

            {appearance.wallpaper === 'custom' && wallpaperImage !== null && (
              <>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    icon={<ImagePlus size={13} strokeWidth={1.5} />}
                    onClick={() => {
                      void pickWallpaper();
                    }}
                  >
                    Заменить
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 size={13} strokeWidth={1.5} />}
                    onClick={() => {
                      set({ wallpaper: 'none' });
                      void clearWallpaper();
                    }}
                  >
                    Убрать
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Slider
                    label="Затемнение"
                    value={appearance.wallpaperDim}
                    min={0}
                    max={90}
                    step={5}
                    valueLabel={`${String(appearance.wallpaperDim)}%`}
                    onChange={(value) => {
                      set({ wallpaperDim: value });
                    }}
                  />
                  <Slider
                    label="Размытие"
                    value={appearance.wallpaperBlur}
                    min={0}
                    max={24}
                    step={1}
                    valueLabel={`${String(appearance.wallpaperBlur)} px`}
                    onChange={(value) => {
                      set({ wallpaperBlur: value });
                    }}
                  />
                </div>
              </>
            )}

            {appearance.wallpaper !== 'none' && (
              <Switch
                checked={appearance.glassPanels}
                onChange={(value) => {
                  set({ glassPanels: value });
                }}
                label="Стеклянные панели"
                description="Карточки становятся полупрозрачными и размывают обои под собой."
              />
            )}
          </Section>

          <Section
            title="Талисман в углу"
            description="Сидит в углу за содержимым и не мешает нажимать на кнопки."
          >
            <div role="radiogroup" className="grid grid-cols-6 gap-2">
              {MASCOTS.map((option) => (
                <Tile
                  key={option.kind}
                  label={option.label}
                  selected={appearance.mascot === option.kind}
                  onSelect={() => {
                    set({ mascot: option.kind });
                  }}
                >
                  <MascotPreview kind={option.kind} custom={null} figure={figure} />
                </Tile>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-2xs font-medium text-text-dim">
                Аниме · картинки со свободной лицензией CC BY-SA с Wikimedia Commons
              </p>
              <div role="radiogroup" className="grid grid-cols-9 gap-2">
                {GALLERY.map((entry) => (
                  <PictureChoice
                    key={entry.id}
                    src={galleryImageUrl(entry)}
                    label={entry.name}
                    selected={appearance.mascot === 'gallery' && appearance.mascotGalleryId === entry.id}
                    onSelect={() => {
                      set({ mascot: 'gallery', mascotGalleryId: entry.id });
                    }}
                  />
                ))}
              </div>
              {selectedGallery !== undefined && (
                <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-2xs text-text-dim">
                  <span className="text-text">{selectedGallery.name}</span>
                  <span>· автор: {selectedGallery.author} ·</span>
                  <button
                    type="button"
                    className="text-accent underline-offset-2 hover:underline"
                    onClick={() => {
                      void openExternal(LICENSE_URLS[selectedGallery.license]);
                    }}
                  >
                    {selectedGallery.license}
                  </button>
                  <span>·</span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline"
                    onClick={() => {
                      void openExternal(selectedGallery.source);
                    }}
                  >
                    оригинал на Wikimedia Commons
                    <ExternalLink size={11} strokeWidth={1.5} />
                  </button>
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-2xs font-medium text-text-dim">
                Мои картинки · хранятся только на этом компьютере
              </p>
              <div role="radiogroup" className="grid grid-cols-9 gap-2">
                {mascots.map((mascot, index) => (
                  <PictureChoice
                    key={mascot.id}
                    src={mascot.url}
                    label={`Картинка ${String(index + 1)}`}
                    selected={appearance.mascot === 'custom' && appearance.mascotCustomId === mascot.id}
                    onSelect={() => {
                      set({ mascot: 'custom', mascotCustomId: mascot.id });
                    }}
                    onRemove={() => {
                      dropMascot(mascot.id);
                    }}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => {
                    void pickMascot();
                  }}
                  className={cn(
                    'flex h-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed',
                    'border-border text-2xs text-text-dim transition-colors duration-fast ease-out',
                    'hover:border-accent hover:text-accent',
                  )}
                >
                  <ImagePlus size={18} strokeWidth={1.5} />
                  Добавить
                </button>
              </div>
            </div>

            {appearance.mascot === 'skin' && (account === null || account.skinUrl === null) && (
              <p className="text-2xs text-text-dim">
                {account === null
                  ? 'Добавьте аккаунт Microsoft — у оффлайн-аккаунтов скина нет.'
                  : 'У этого аккаунта нет скина (оффлайн-аккаунты его не имеют) — угол останется пустым.'}
              </p>
            )}

            {appearance.mascot !== 'none' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <Slider
                    label="Размер"
                    value={appearance.mascotSize}
                    min={64}
                    max={320}
                    step={8}
                    valueLabel={`${String(appearance.mascotSize)} px`}
                    onChange={(value) => {
                      set({ mascotSize: value });
                    }}
                  />
                  <Slider
                    label="Непрозрачность"
                    value={appearance.mascotOpacity}
                    min={10}
                    max={100}
                    step={5}
                    valueLabel={`${String(appearance.mascotOpacity)}%`}
                    onChange={(value) => {
                      set({ mascotOpacity: value });
                    }}
                  />
                </div>
                <Segmented
                  value={appearance.mascotSide}
                  options={[
                    { value: 'left', label: 'Слева' },
                    { value: 'right', label: 'Справа' },
                  ]}
                  onChange={(value) => {
                    set({ mascotSide: value });
                  }}
                />
              </>
            )}
          </Section>

          <Section title="Интерфейс">
            <div className="grid grid-cols-2 gap-4">
              <Slider
                label="Масштаб"
                value={appearance.uiScale}
                min={80}
                max={130}
                step={5}
                valueLabel={`${String(appearance.uiScale)}%`}
                onChange={(value) => {
                  set({ uiScale: value });
                }}
              />
              <Slider
                label="Скругление углов"
                value={appearance.radius}
                min={0}
                max={16}
                step={1}
                valueLabel={appearance.radius === 0 ? 'острые' : `${String(appearance.radius)} px`}
                onChange={(value) => {
                  set({ radius: value });
                }}
              />
            </div>
            <Switch
              checked={appearance.reduceMotion}
              onChange={(value) => {
                set({ reduceMotion: value });
              }}
              label="Меньше анимаций"
              description="Отключает плавные переходы и появление элементов."
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
