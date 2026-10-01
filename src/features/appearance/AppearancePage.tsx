import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { AlertTriangle, ExternalLink, ImagePlus, Pipette, RotateCcw, Trash2, User, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Segmented';
import { Slider } from '@/components/ui/Slider';
import { Switch } from '@/components/ui/Switch';
import { Page } from '@/components/layout/PageHeader';
import { accentPalette, contrastRatio, parseHex, toHex } from '@/lib/color';
import { canSeeThrough, resolveTheme } from '@/lib/appearance';
import { openExternal } from '@/api/system';
import { activeAccountOf, useAccounts } from '@/store/useAccounts';
import { useAppearanceImages } from '@/store/useAppearanceImages';
import { useSettings } from '@/store/useSettings';
import type { Appearance, ThemeMode, WallpaperKind } from '@/types/settings';
import { DEFAULT_APPEARANCE, RADIUS_MAX } from '@/types/settings';
import { DotsWallpaper, ForestWallpaper, MistWallpaper } from './art';
import { GALLERY, LICENSE_URLS, galleryImageUrl, galleryMascot } from './gallery';
import { languageSetting, setLanguage, t } from '@/lib/i18n';

const ACCENTS: readonly { readonly hex: string; readonly name: string }[] = [
  { hex: '#A855F7', name: t`Фиолетовый` },
  { hex: '#6366F1', name: t`Индиго` },
  { hex: '#0EA5E9', name: t`Голубой` },
  { hex: '#14B8A6', name: t`Бирюзовый` },
  { hex: '#22C55E', name: t`Зелёный` },
  { hex: '#EAB308', name: t`Жёлтый` },
  { hex: '#F97316', name: t`Оранжевый` },
  { hex: '#EF4444', name: t`Красный` },
  { hex: '#EC4899', name: t`Розовый` },
  { hex: '#A1A1AA', name: t`Графит` },
];

interface Preset {
  readonly name: string;
  readonly accent: string;
  readonly theme: 'dark' | 'light';
  readonly wallpaper: WallpaperKind;
}

/** One-click looks: colour, light or dark, and the wallpaper. */
const PRESETS: readonly Preset[] = [
  { name: t`Фиолетовая ночь`, accent: '#A855F7', theme: 'dark', wallpaper: 'none' },
  { name: t`Хвойный лес`, accent: '#22C55E', theme: 'dark', wallpaper: 'forest' },
  { name: t`Океан`, accent: '#0EA5E9', theme: 'dark', wallpaper: 'none' },
  { name: t`Хеллоуин`, accent: '#F97316', theme: 'dark', wallpaper: 'none' },
  { name: t`Сакура`, accent: '#EC4899', theme: 'dark', wallpaper: 'none' },
  { name: t`Космос`, accent: '#6366F1', theme: 'dark', wallpaper: 'dots' },
  { name: t`Монохром`, accent: '#A1A1AA', theme: 'dark', wallpaper: 'none' },
  { name: t`Мятный лёд`, accent: '#14B8A6', theme: 'dark', wallpaper: 'none' },
];

const THEMES: readonly { readonly value: ThemeMode; readonly label: string }[] = [
  { value: 'dark', label: t`Тёмная` },
  { value: 'light', label: t`Светлая` },
  { value: 'system', label: t`Как в системе` },
];

const WALLPAPERS: readonly { readonly kind: WallpaperKind; readonly label: string }[] = [
  { kind: 'none', label: t`Без обоев` },
  { kind: 'mist', label: t`Туман` },
  { kind: 'dots', label: t`Точки` },
  { kind: 'forest', label: t`Хвойный лес` },
  { kind: 'custom', label: t`Своё изображение` },
];

type MascotChoice = 'none' | 'skin' | 'gallery' | 'custom';

const MASCOT_CHOICES: readonly { readonly kind: MascotChoice; readonly label: string }[] = [
  { kind: 'none', label: t`Без талисмана` },
  { kind: 'skin', label: t`Мой скин` },
  { kind: 'gallery', label: t`Из галереи` },
  { kind: 'custom', label: t`Мои картинки` },
];

/** The browser's colour picker that samples anywhere on screen. */
interface EyeDropperApi {
  open: () => Promise<{ sRGBHex: string }>;
}
type EyeDropperConstructor = new () => EyeDropperApi;

function channels(hex: string, theme: 'dark' | 'light'): { a: string; b: string; c: string } {
  const base = parseHex(hex);
  if (base === null) return { a: hex, b: hex, c: hex };
  const palette = accentPalette(base, theme);
  return { a: toHex(palette.accent), b: toHex(palette.second), c: toHex(palette.third) };
}

/** A tiny launcher in the preset's colours: a dark window, one glow, faint panes. */
function PresetPreview({ preset }: { preset: Preset }): ReactElement {
  const dark = preset.theme === 'dark';
  const accent = parseHex(channels(preset.accent, preset.theme).a);
  const rgb = accent === null ? '168 85 247' : `${String(accent.r)} ${String(accent.g)} ${String(accent.b)}`;
  const scope = {
    '--accent-rgb': rgb,
    '--text-dim-rgb': dark ? '168 166 178' : '96 92 108',
    background: [
      `radial-gradient(90% 80% at 15% 10%, rgb(${rgb} / ${dark ? '0.28' : '0.22'}), transparent 70%)`,
      dark ? '#0c0c10' : '#f1eff5',
    ].join(', '),
  } as CSSProperties;
  const box = (style: CSSProperties): ReactElement => (
    <div
      className="absolute rounded-[6px]"
      style={{
        background: dark ? 'rgb(255 255 255 / 0.05)' : 'rgb(255 255 255 / 0.7)',
        boxShadow: dark ? 'inset 0 0 0 1px rgb(255 255 255 / 0.08)' : 'inset 0 0 0 1px rgb(22 19 31 / 0.06)',
        ...style,
      }}
    />
  );
  return (
    <div className="relative aspect-video overflow-hidden" style={{ ...scope, borderRadius: 'calc(var(--radius) - 8px)' }}>
      {preset.wallpaper === 'dots' && <DotsWallpaper />}
      {preset.wallpaper === 'forest' && <ForestWallpaper />}
      {box({ left: '8%', top: '14%', bottom: '14%', width: '12%' })}
      {box({ left: '25%', right: '8%', top: '14%', height: '22%' })}
      {box({ left: '25%', width: '31%', top: '44%', bottom: '14%' })}
      {box({ right: '8%', width: '31%', top: '44%', bottom: '14%' })}
      <span className="absolute left-[25%] top-[44%] m-[6%] h-[6%] w-[14%] rounded-full" style={{ background: `rgb(${rgb})` }} />
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="glass rounded-xl p-[18px]">
      <h2 className="mb-3 text-[15px] font-semibold tracking-[-0.01em] text-text">{title}</h2>
      {children}
    </section>
  );
}

function Label({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return <p className={cn('mb-2 text-[13px] text-text-dim', className)}>{children}</p>;
}

function WallpaperPreview({ kind, custom }: { kind: WallpaperKind; custom: string | null }): ReactElement | null {
  switch (kind) {
    case 'none':
      return null;
    case 'mist':
      return <MistWallpaper />;
    case 'dots':
      return <DotsWallpaper />;
    case 'forest':
      return <ForestWallpaper />;
    case 'custom':
      return custom === null ? null : (
        <img src={custom} alt="" className="absolute inset-0 h-full w-full object-cover" />
      );
  }
}

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
          'flex h-20 w-full items-end justify-center overflow-hidden rounded-[12px] bg-[var(--chip)] pt-1',
          'transition-shadow duration-fast',
          selected
            ? 'shadow-[inset_0_0_0_1.5px_rgb(var(--accent-rgb)),0_0_0_3px_rgb(var(--accent-rgb)/0.25)]'
            : 'shadow-rim hover:bg-[var(--hover)]',
        )}
      >
        <img src={src} alt={label} loading="lazy" className="h-full w-auto object-contain" />
      </button>
      {onRemove !== undefined && (
        <button
          type="button"
          aria-label={t`Удалить: ${label}`}
          title={t`Удалить`}
          onClick={onRemove}
          className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-[var(--sheet-solid)] text-text-dim opacity-0 transition-opacity duration-fast hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
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
  const set = (next: Partial<Appearance>): void => {
    patchAppearance(next);
  };

  const accent = appearance.accent.toUpperCase();
  const [hexDraft, setHexDraft] = useState(accent);
  useEffect(() => {
    setHexDraft(accent);
  }, [accent]);
  const colorInput = useRef<HTMLInputElement>(null);
  const [demo, setDemo] = useState(62);
  const [demoOn, setDemoOn] = useState(true);

  const lowContrast = useMemo(() => {
    const color = parseHex(accent);
    if (color === null) return false;
    const background = theme === 'dark' ? { r: 14, g: 11, b: 22 } : { r: 244, g: 241, b: 250 };
    return contrastRatio(color, background) < 2.2;
  }, [accent, theme]);

  const [mascotTab, setMascotTab] = useState<MascotChoice>(
    appearance.mascot === 'custom' || appearance.mascot === 'gallery' || appearance.mascot === 'skin'
      ? appearance.mascot
      : 'none',
  );
  const selectedGallery =
    appearance.mascot === 'gallery' ? galleryMascot(appearance.mascotGalleryId) : undefined;

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
  const chooseMascot = (kind: MascotChoice): void => {
    setMascotTab(kind);
    if (kind === 'none' || kind === 'skin') set({ mascot: kind });
    else if (kind === 'gallery') set({ mascot: 'gallery' });
    else if (mascots.length > 0) {
      const keep = mascots.some((mascot) => mascot.id === appearance.mascotCustomId);
      set({ mascot: 'custom', ...(keep ? {} : { mascotCustomId: mascots[0]?.id ?? '' }) });
    }
  };

  const eyedrop = async (): Promise<void> => {
    const Dropper = (window as unknown as { EyeDropper?: EyeDropperConstructor }).EyeDropper;
    if (Dropper === undefined) {
      colorInput.current?.click();
      return;
    }
    try {
      const picked = await new Dropper().open();
      set({ accent: picked.sRGBHex.toUpperCase() });
    } catch {
      // Escape pressed: nothing chosen.
    }
  };

  return (
    <Page
      title={t`Оформление`}
      subtitle={t`изменения применяются сразу`}
      actions={
        <Button
          variant="glass"
          icon={<RotateCcw size={15} strokeWidth={1.8} />}
          onClick={() => {
            void patch({ theme: 'dark', appearance: DEFAULT_APPEARANCE });
          }}
        >
          {t`Сбросить всё`}
        </Button>
      }
    >
      <p className="mb-3 mt-2 text-xs font-bold uppercase tracking-[0.06em] text-text-dim">{t`Темы`}</p>
      <div role="radiogroup" className="grid grid-cols-4 gap-3.5">
        {PRESETS.map((preset, index) => {
          const selected =
            preset.accent === accent &&
            preset.wallpaper === appearance.wallpaper &&
            preset.theme === theme;
          const { a } = channels(preset.accent, preset.theme);
          return (
            <button
              key={preset.name}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                void patch({
                  theme: preset.theme,
                  appearance: { ...appearance, accent: preset.accent, wallpaper: preset.wallpaper },
                });
              }}
              className="glass stagger rounded-xl p-2 pb-3 text-left transition-shadow duration-slow"
              style={
                {
                  '--i': index,
                  ...(selected ? { boxShadow: `0 0 0 1.5px ${a}` } : {}),
                } as CSSProperties
              }
            >
              <PresetPreview preset={preset} />
              <span className="block truncate px-1 pt-2.5 text-[13px] font-semibold text-text">
                {preset.name}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-[22px] grid grid-cols-2 items-start gap-3.5">
        <div className="flex flex-col gap-3.5">
          <Card title={t`Режим`}>
            <Segmented
              fullWidth
              label={t`Режим`}
              value={themeMode}
              options={THEMES}
              onChange={(value) => {
                void patch({ theme: value });
              }}
            />

            <h2 className="mb-3 mt-5 text-[15px] font-semibold tracking-[-0.01em] text-text">
              {t`Акцентный цвет`}
            </h2>
            <div role="radiogroup" aria-label={t`Цвет акцента`} className="flex flex-wrap gap-2.5">
              {ACCENTS.map((swatch) => {
                const on = swatch.hex === accent;
                return (
                  <button
                    key={swatch.hex}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    title={swatch.name}
                    onClick={() => {
                      set({ accent: swatch.hex });
                    }}
                    className="h-7 w-7 rounded-full transition-[box-shadow,transform] duration-fast hover:scale-110"
                    style={{
                      background: swatch.hex,
                      boxShadow: on
                        ? `0 0 0 2px rgb(var(--bg-rgb)), 0 0 0 4px ${swatch.hex}, inset 0 1px 0 rgb(255 255 255 / 0.5)`
                        : 'inset 0 1px 0 rgb(255 255 255 / 0.45), inset 0 0 0 1px rgb(255 255 255 / 0.18)',
                    }}
                  />
                );
              })}
            </div>

            <div className="relative mt-3.5 flex gap-2">
              <input
                value={hexDraft}
                spellCheck={false}
                aria-label={t`Свой цвет акцента`}
                onChange={(event) => {
                  let value = event.target.value.toUpperCase();
                  if (!value.startsWith('#')) value = `#${value}`;
                  value = value.slice(0, 7);
                  setHexDraft(value);
                  if (/^#[0-9A-F]{6}$/.test(value)) set({ accent: value });
                }}
                className="field h-[34px] min-w-0 flex-1 rounded-[12px] px-3 font-mono text-[13px] font-medium text-text outline-none focus:shadow-[inset_0_0_0_1px_var(--glass-border),0_0_0_3px_rgb(var(--accent-rgb)/0.35)]"
              />
              <Button
                size="sm"
                className="h-[34px] rounded-[12px]"
                icon={<Pipette size={14} strokeWidth={1.8} />}
                onClick={() => {
                  void eyedrop();
                }}
              >
                {t`Пипетка`}
              </Button>
              <input
                ref={colorInput}
                type="color"
                tabIndex={-1}
                aria-hidden
                value={accent.toLowerCase()}
                onChange={(event) => {
                  set({ accent: event.target.value.toUpperCase() });
                }}
                className="pointer-events-none absolute bottom-0 right-0 h-px w-px opacity-0"
              />
            </div>

            {lowContrast && (
              <p className="mt-2.5 flex items-center gap-2 text-xs text-danger">
                <AlertTriangle size={13} strokeWidth={1.8} />
                {theme === 'dark'
                  ? t`Этот цвет плохо виден на тёмном фоне.`
                  : t`Этот цвет плохо виден на светлом фоне.`}
              </p>
            )}

            <div className="mt-[18px] rounded-[14px] bg-[var(--chip)] p-3.5">
              <p className="mb-2 text-[11.5px] text-text-faint">{t`Предпросмотр элементов`}</p>
              <Slider value={demo} min={0} max={100} onChange={setDemo} />
              <div className="mt-2.5 flex items-center gap-2.5">
                <Switch checked={demoOn} onChange={setDemoOn} />
                <Button variant="primary" size="sm">
                  {t`Кнопка`}
                </Button>
              </div>
            </div>
          </Card>

          <Card title={t`Интерфейс`}>
            <Label>{t`Язык`}</Label>
            <Segmented
              fullWidth
              label={t`Язык`}
              value={languageSetting()}
              options={[
                { value: 'ru', label: 'Русский' },
                { value: 'en', label: 'English' },
                { value: 'system', label: t`Как в системе` },
              ]}
              onChange={(value) => {
                setLanguage(value);
              }}
            />
            <div className="mt-4 flex flex-col gap-3">
              <Slider
                label={t`Масштаб`}
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
                label={t`Скругление углов`}
                value={appearance.radius}
                min={0}
                max={RADIUS_MAX}
                step={1}
                valueLabel={appearance.radius === 0 ? t`острые` : `${String(appearance.radius)} px`}
                onChange={(value) => {
                  set({ radius: value });
                }}
              />
            </div>
            <div className="mt-3.5">
              <Switch
                checked={appearance.reduceMotion}
                onChange={(value) => {
                  set({ reduceMotion: value });
                }}
                label={t`Меньше движения`}
                description={t`Отключает пружины, наклон карточек и фоновую анимацию`}
              />
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-3.5">
          <Card title={t`Фон и стекло`}>
            <div role="radiogroup" className="grid grid-cols-5 gap-2">
              {WALLPAPERS.map((option) => {
                const selected = appearance.wallpaper === option.kind;
                return (
                  <button
                    key={option.kind}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      if (option.kind === 'custom' && wallpaperImage === null) void pickWallpaper();
                      else set({ wallpaper: option.kind });
                    }}
                    className="flex flex-col gap-1.5 text-center text-[11px] text-text-dim"
                  >
                    <span
                      className={cn(
                        'relative block aspect-square overflow-hidden rounded-[12px] transition-shadow duration-fast',
                        theme === 'dark' ? 'bg-[#15121f]' : 'bg-[#f3f0f9]',
                        option.kind === 'custom' &&
                          wallpaperImage === null &&
                          '[background:repeating-linear-gradient(135deg,var(--chip)_0_6px,transparent_6px_12px)]',
                      )}
                      style={{
                        boxShadow: selected
                          ? 'inset 0 0 0 1.5px rgb(var(--accent-rgb)), 0 0 0 3px rgb(var(--accent-rgb) / 0.25)'
                          : 'inset 0 0 0 1px var(--glass-border)',
                      }}
                    >
                      <WallpaperPreview kind={option.kind} custom={wallpaperImage} />
                      {option.kind === 'custom' && wallpaperImage === null && (
                        <ImagePlus
                          size={18}
                          strokeWidth={1.6}
                          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                        />
                      )}
                    </span>
                    <span className="leading-tight">{option.label}</span>
                  </button>
                );
              })}
            </div>

            {appearance.wallpaper === 'custom' && wallpaperImage !== null && (
              <div className="mt-3.5 flex flex-col gap-3">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    icon={<ImagePlus size={13} strokeWidth={1.6} />}
                    onClick={() => {
                      void pickWallpaper();
                    }}
                  >
                    {t`Заменить`}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 size={13} strokeWidth={1.6} />}
                    onClick={() => {
                      set({ wallpaper: 'none' });
                      void clearWallpaper();
                    }}
                  >
                    {t`Убрать`}
                  </Button>
                </div>
                <Slider
                  label={t`Затемнение`}
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
                  label={t`Размытие`}
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
            )}

            <div className="mt-[18px]">
              <Switch
                checked={appearance.glassPanels}
                onChange={(value) => {
                  set({ glassPanels: value });
                }}
                label={t`Эффект стекла`}
              />
            </div>
            {canSeeThrough() && (
            <div className="mt-3.5">
              <Slider
                label={t`Прозрачность окна`}
                value={appearance.windowTransparency}
                min={0}
                max={45}
                step={5}
                valueLabel={
                  appearance.windowTransparency === 0
                    ? t`выключена`
                    : `${String(appearance.windowTransparency)}%`
                }
                onChange={(value) => {
                  set({ windowTransparency: value });
                }}
              />
            </div>
            )}
          </Card>

          <Card title={t`Талисман`}>
            <div role="radiogroup" className="grid grid-cols-2 gap-2">
              {MASCOT_CHOICES.map((choice) => {
                const selected = mascotTab === choice.kind;
                return (
                  <button
                    key={choice.kind}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      chooseMascot(choice.kind);
                    }}
                    className="h-[38px] rounded-[12px] bg-[var(--chip)] text-[12.5px] font-medium text-text transition-shadow duration-fast"
                    style={{
                      boxShadow: selected
                        ? 'inset 0 0 0 1.5px rgb(var(--accent-rgb)), 0 0 0 3px rgb(var(--accent-rgb) / 0.25)'
                        : 'inset 0 0 0 1px var(--glass-border)',
                    }}
                  >
                    {choice.label}
                  </button>
                );
              })}
            </div>

            {mascotTab === 'skin' && (
              <div className="mt-3 flex items-center gap-3 text-xs text-text-faint">
                <span className="grid h-20 w-14 shrink-0 place-items-center rounded-[12px] bg-[var(--chip)]">
                  {figure === null ? (
                    <User size={20} strokeWidth={1.5} />
                  ) : (
                    <img src={figure} alt="" className="pixelated h-[72px] w-auto" />
                  )}
                </span>
                {account === null || account.skinUrl === null
                  ? t`У оффлайн-аккаунтов скина нет — угол останется пустым. Войдите через Microsoft.`
                  : t`Скин активного аккаунта во весь рост.`}
              </div>
            )}

            {mascotTab === 'gallery' && (
              <div className="mt-3">
                <div role="radiogroup" className="grid grid-cols-5 gap-2">
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
                  <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-text-faint">
                    <span className="text-text-dim">{selectedGallery.name}</span>
                    <span>{t`· автор: `}{selectedGallery.author} ·</span>
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
                      {t`оригинал на Wikimedia Commons`}
                      <ExternalLink size={11} strokeWidth={1.5} />
                    </button>
                  </p>
                )}
              </div>
            )}

            {mascotTab === 'custom' && (
              <div className="mt-3">
                <div role="radiogroup" className="grid grid-cols-5 gap-2">
                  {mascots.map((mascot, index) => (
                    <PictureChoice
                      key={mascot.id}
                      src={mascot.url}
                      label={t`Картинка ${String(index + 1)}`}
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
                    className="flex h-20 flex-col items-center justify-center gap-1 rounded-[12px] border border-dashed border-[var(--glass-border)] text-[11px] text-text-dim transition-colors duration-fast hover:border-accent hover:text-accent"
                  >
                    <ImagePlus size={18} strokeWidth={1.5} />
                    {t`Добавить`}
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-text-faint">{t`Хранятся только на этом компьютере.`}</p>
              </div>
            )}

            {mascotTab !== 'none' && (
              <div className="mt-4 flex flex-col gap-3">
                <Slider
                  label={t`Размер`}
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
                  label={t`Непрозрачность`}
                  value={appearance.mascotOpacity}
                  min={10}
                  max={100}
                  step={5}
                  valueLabel={`${String(appearance.mascotOpacity)}%`}
                  onChange={(value) => {
                    set({ mascotOpacity: value });
                  }}
                />
                <div>
                  <Label>{t`Положение`}</Label>
                  <Segmented
                    fullWidth
                    label={t`Положение`}
                    value={appearance.mascotSide}
                    options={[
                      { value: 'left', label: t`Слева` },
                      { value: 'right', label: t`Справа` },
                    ]}
                    onChange={(value) => {
                      set({ mascotSide: value });
                    }}
                  />
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}
