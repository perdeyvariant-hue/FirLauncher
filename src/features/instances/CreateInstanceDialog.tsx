import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Check, ImagePlus, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { IconButton } from '@/components/ui/IconButton';
import { Segmented } from '@/components/ui/Segmented';
import { Select } from '@/components/ui/Select';
import type { SelectOption } from '@/components/ui/Select';
import { ART_GRADIENTS, artGradient } from '@/lib/art';
import { initialsOf } from '@/lib/format';
import { GLYPHS, Glyph, LETTERS, suggestGlyph } from '@/lib/glyphs';
import { isTauri, toLauncherError } from '@/lib/ipc';
import * as metaApi from '@/api/meta';
import type { LoaderVersion, MinecraftVersion } from '@/types/version';
import type { ModLoader } from '@/types/instance';
import { LOADER_LABELS, MOD_LOADERS } from '@/types/instance';
import { useInstances } from '@/store/useInstances';
import { useSettings } from '@/store/useSettings';
import { CoverPicker } from './CoverPicker';

function randomGlyph(): string {
  return GLYPHS[Math.floor(Math.random() * GLYPHS.length)]?.id ?? 'cube';
}
import { useToasts } from '@/store/useToasts';
import { useUI } from '@/store/useUI';
import { t } from '@/lib/i18n';

export interface CreateInstanceDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CreateInstanceDialog({ open, onClose }: CreateInstanceDialogProps): ReactElement {
  const create = useInstances((state) => state.create);
  const openInstance = useUI((state) => state.openInstance);
  const fail = useToasts((state) => state.fail);

  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const showSnapshots = useSettings((state) => state.settings.showSnapshots);
  const [color, setColor] = useState(0);
  // Chosen by hand; until then the name suggests one, or a random pick.
  const [glyph, setGlyph] = useState<string | null>(null);
  const [fallbackGlyph, setFallbackGlyph] = useState(randomGlyph);
  const [versions, setVersions] = useState<MinecraftVersion[]>([]);
  const [mcVersion, setMcVersion] = useState('');
  const [loader, setLoader] = useState<ModLoader>('vanilla');
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[]>([]);
  const [loaderVersion, setLoaderVersion] = useState<string | null>(null);
  const [iconPath, setIconPath] = useState<string | null>(null);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [loadingLoader, setLoadingLoader] = useState(false);
  // "This loader does not support that Minecraft version" is an ordinary
  // answer, shown under the field rather than as an error toast.
  const [loaderError, setLoaderError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset whenever the dialog is reopened.
  useEffect(() => {
    if (!open) return;
    setName('');
    setNameTouched(false);
    setLoader('vanilla');
    setLoaderVersion(null);
    setIconPath(null);
    setColor(Math.floor(Math.random() * ART_GRADIENTS.length));
    setGlyph(null);
    setFallbackGlyph(randomGlyph());
    setSubmitting(false);

    let cancelled = false;
    setLoadingVersions(true);
    metaApi
      .listMinecraftVersions()
      .then((list) => {
        if (cancelled) return;
        setVersions(list);
        const firstRelease = list.find((version) => version.type === 'release');
        setMcVersion(firstRelease?.id ?? list[0]?.id ?? '');
      })
      .catch((raw: unknown) => {
        if (!cancelled) fail(raw);
      })
      .finally(() => {
        if (!cancelled) setLoadingVersions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, fail]);

  // Loader builds depend on both the loader and the Minecraft version.
  useEffect(() => {
    setLoaderError(null);
    if (!open || loader === 'vanilla' || mcVersion === '') {
      setLoaderVersions([]);
      setLoaderVersion(null);
      return;
    }

    let cancelled = false;
    setLoadingLoader(true);
    metaApi
      .listLoaderVersions(loader, mcVersion)
      .then((list) => {
        if (cancelled) return;
        setLoaderVersions(list);
        const preferred = list.find((item) => item.recommended) ?? list[0];
        setLoaderVersion(preferred?.version ?? null);
      })
      .catch((raw: unknown) => {
        if (cancelled) return;
        setLoaderVersions([]);
        setLoaderVersion(null);
        setLoaderError(toLauncherError(raw).message);
      })
      .finally(() => {
        if (!cancelled) setLoadingLoader(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, loader, mcVersion]);

  const versionOptions = useMemo<SelectOption<string>[]>(
    () =>
      versions
        .filter((version) => showSnapshots || version.type === 'release')
        .map((version) => ({
          value: version.id,
          label: version.type === 'release' ? version.id : t`${version.id} · снапшот`,
        })),
    [versions, showSnapshots],
  );

  // The newest releases, one tap each; everything else is in the list.
  const quickVersions = useMemo(
    () => versions.filter((version) => version.type === 'release').slice(0, 6).map((version) => version.id),
    [versions],
  );
  const loaderOrder: readonly ModLoader[] = ['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'];
  const loaderOptions = loaderOrder
    .filter((item) => MOD_LOADERS.includes(item))
    .map((item) => ({ value: item, label: LOADER_LABELS[item] }));

  const loaderVersionOptions: SelectOption<string>[] = loaderVersions.map((item) => ({
    value: item.version,
    label: item.recommended
      ? t`${item.version} · рекомендуемая`
      : item.stable
        ? item.version
        : t`${item.version} · нестабильная`,
  }));

  const trimmedName = name.trim();
  const shownGlyph = glyph ?? suggestGlyph(trimmedName) ?? fallbackGlyph;
  const nameError =
    nameTouched && trimmedName === '' ? t`Введите имя сборки` : null;
  const canSubmit =
    trimmedName !== '' &&
    mcVersion !== '' &&
    (loader === 'vanilla' || loaderVersion !== null) &&
    !submitting;

  const pickIcon = async (): Promise<void> => {
    if (!isTauri()) {
      useToasts.getState().notify(t`Выбор файла доступен только в приложении`);
      return;
    }
    try {
      const { open: openFileDialog } = await import('@tauri-apps/plugin-dialog');
      const selected = await openFileDialog({
        multiple: false,
        filters: [{ name: t`Изображение`, extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      });
      if (typeof selected === 'string') setIconPath(selected);
    } catch (raw) {
      fail(raw);
    }
  };

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    const instance = await create({
      name: trimmedName,
      mcVersion,
      loader,
      loaderVersion: loader === 'vanilla' ? null : loaderVersion,
      iconPath,
      color,
      glyph: shownGlyph,
    });
    setSubmitting(false);
    if (instance === null) return;
    onClose();
    openInstance(instance.id);
  };

  const recommended = loaderVersions.find((item) => item.recommended)?.version ?? null;
  const loaderHint =
    loader === 'vanilla'
      ? t`Без загрузчика модов · Minecraft ${mcVersion}`
      : loaderError !== null
        ? loaderError
        : loadingLoader
          ? t`Ищем версии ${LOADER_LABELS[loader]}…`
          : loaderVersion !== null && loaderVersion === recommended
            ? t`${LOADER_LABELS[loader]} ${loaderVersion} · рекомендуемая для ${mcVersion}`
            : loaderVersion !== null
              ? t`${LOADER_LABELS[loader]} ${loaderVersion} для ${mcVersion}`
              : t`Нет сборок ${LOADER_LABELS[loader]} для ${mcVersion}`;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t`Новая сборка`}
      busy={submitting}
      footer={
        <>
          <Button onClick={onClose} disabled={submitting}>
            {t`Отмена`}</Button>
          <Button
            variant="primary"
            disabled={!canSubmit}
            loading={submitting}
            onClick={() => {
              void submit();
            }}
          >
            {t`Создать`}</Button>
        </>
      }
    >
      <div className="flex flex-col pb-1 pt-2">
        <div className="flex items-center gap-3.5">
          <button
            type="button"
            title={iconPath === null ? t`Выбрать иконку` : t`Иконка: ${iconPath.split(/[\\/]/).pop() ?? iconPath}`}
            onClick={() => {
              void pickIcon();
            }}
            className="group relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-[16px] font-mono text-[17px] font-bold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35)] transition-transform duration-fast active:scale-95"
            style={{ background: artGradient(color) }}
          >
            {/* The picked file lives outside the webview's reach, so the
                preview stays symbolic until the backend stores it. */}
            {iconPath !== null ? (
              <Check size={20} strokeWidth={2.2} />
            ) : shownGlyph === LETTERS ? (
              <span className="transition-opacity group-hover:opacity-0">
                {initialsOf(trimmedName === '' ? t`Новая сборка` : trimmedName)}
              </span>
            ) : (
              <span className="transition-opacity group-hover:opacity-0">
                <Glyph id={shownGlyph} size={26} strokeWidth={1.9} />
              </span>
            )}
            {iconPath === null && (
              <ImagePlus
                size={18}
                strokeWidth={1.8}
                className="absolute opacity-0 transition-opacity group-hover:opacity-100"
              />
            )}
          </button>

          <div className="min-w-0 flex-1">
            <div className="field flex h-[38px] items-center rounded-[12px] px-3 focus-within:shadow-[inset_0_0_0_1px_var(--glass-border),0_0_0_3px_rgb(var(--accent-rgb)/0.35)]">
              <input
                value={name}
                placeholder={t`Название сборки`}
                aria-label={t`Название сборки`}
                aria-invalid={nameError !== null}
                autoFocus
                onChange={(event) => {
                  setName(event.target.value);
                }}
                onBlur={() => {
                  setNameTouched(true);
                }}
                className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
              />
              {iconPath !== null && (
                <IconButton
                  label={t`Убрать иконку`}
                  size="sm"
                  icon={<X size={13} strokeWidth={1.75} />}
                  onClick={() => {
                    setIconPath(null);
                  }}
                />
              )}
            </div>
            {nameError !== null && <p className="mt-1.5 text-xs text-danger">{nameError}</p>}
          </div>
        </div>

        <p className="mb-2 mt-5 text-[13px] text-text-dim">{t`Обложка`}</p>
        <CoverPicker color={color} glyph={shownGlyph} onColor={setColor} onGlyph={setGlyph} />

        <p className="mb-2 mt-5 text-[13px] text-text-dim">{t`Версия Minecraft`}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {quickVersions.map((version) => (
            <button
              key={version}
              type="button"
              onClick={() => {
                setMcVersion(version);
              }}
              className={cn(
                'h-[30px] rounded-pill px-3 font-mono text-xs font-medium transition-[filter,transform] duration-fast active:scale-95',
                version === mcVersion
                  ? 'bg-[image:var(--accent-gradient)] text-white'
                  : 'bg-[var(--chip)] text-text hover:bg-[var(--hover)]',
              )}
            >
              {version}
            </button>
          ))}
          <Select
            compact
            className="w-auto"
            // A version already on a chip is not repeated here.
            value={quickVersions.includes(mcVersion) ? '' : mcVersion}
            options={
              versionOptions.length > 0
                ? [{ value: '', label: t`Другая версия…`, disabled: true }, ...versionOptions]
                : [{ value: '', label: loadingVersions ? t`Загрузка…` : t`Нет версий` }]
            }
            disabled={loadingVersions || versionOptions.length === 0}
            onChange={(value) => {
              if (value !== '') setMcVersion(value);
            }}
          />
        </div>

        <p className="mb-2 mt-[18px] text-[13px] text-text-dim">{t`Загрузчик модов`}</p>
        <Segmented
          fullWidth
          label={t`Загрузчик модов`}
          value={loader}
          options={loaderOptions}
          onChange={setLoader}
        />
        <div className="mt-2 flex min-h-8 items-center gap-2">
          <p className={cn('min-w-0 flex-1 text-xs', loaderError === null ? 'text-text-faint' : 'text-danger')}>
            {loaderHint}
          </p>
          {loader !== 'vanilla' && loaderVersionOptions.length > 1 && (
            <Select
              compact
              className="w-auto"
              value={loaderVersion ?? ''}
              options={loaderVersionOptions}
              onChange={(value) => {
                setLoaderVersion(value === '' ? null : value);
              }}
            />
          )}
        </div>
      </div>
    </Dialog>
  );
}
