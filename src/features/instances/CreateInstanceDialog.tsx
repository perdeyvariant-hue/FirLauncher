import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { Check, ImagePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { SelectOption } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { initialsOf } from '@/lib/format';
import { isTauri, toLauncherError } from '@/lib/ipc';
import * as metaApi from '@/api/meta';
import type { LoaderVersion, MinecraftVersion } from '@/types/version';
import type { ModLoader } from '@/types/instance';
import { LOADER_LABELS, MOD_LOADERS } from '@/types/instance';
import { useInstances } from '@/store/useInstances';
import { useToasts } from '@/store/useToasts';
import { useUI } from '@/store/useUI';

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
  const [showSnapshots, setShowSnapshots] = useState(false);
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
          label: version.type === 'release' ? version.id : `${version.id} · снапшот`,
        })),
    [versions, showSnapshots],
  );

  const loaderOptions: SelectOption<ModLoader>[] = MOD_LOADERS.map((item) => ({
    value: item,
    label: LOADER_LABELS[item],
  }));

  const loaderVersionOptions: SelectOption<string>[] = loaderVersions.map((item) => ({
    value: item.version,
    label: item.recommended
      ? `${item.version} · рекомендуемая`
      : item.stable
        ? item.version
        : `${item.version} · нестабильная`,
  }));

  const trimmedName = name.trim();
  const nameError =
    nameTouched && trimmedName === '' ? 'Введите имя сборки' : null;
  const canSubmit =
    trimmedName !== '' &&
    mcVersion !== '' &&
    (loader === 'vanilla' || loaderVersion !== null) &&
    !submitting;

  const pickIcon = async (): Promise<void> => {
    if (!isTauri()) {
      useToasts.getState().notify('Выбор файла доступен только в приложении');
      return;
    }
    try {
      const { open: openFileDialog } = await import('@tauri-apps/plugin-dialog');
      const selected = await openFileDialog({
        multiple: false,
        filters: [{ name: 'Изображение', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
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
    });
    setSubmitting(false);
    if (instance === null) return;
    onClose();
    openInstance(instance.id);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Новая сборка"
      description="Версия и лоадер скачаются при первом запуске."
      busy={submitting}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Отмена
          </Button>
          <Button
            variant="primary"
            disabled={!canSubmit}
            loading={submitting}
            onClick={() => {
              void submit();
            }}
          >
            Создать
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 py-2">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => {
              void pickIcon();
            }}
            className="group relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-surface-2 text-text-dim transition-colors duration-fast ease-out hover:border-accent hover:text-accent"
          >
            {/* The picked file lives outside the webview's reach, so the
                preview stays symbolic until the backend stores it. */}
            {iconPath !== null ? (
              <Check size={18} strokeWidth={1.5} className="text-accent" />
            ) : trimmedName === '' ? (
              <ImagePlus size={18} strokeWidth={1.5} />
            ) : (
              <span className="text-sm font-semibold">{initialsOf(trimmedName)}</span>
            )}
          </button>

          <div className="min-w-0 flex-1">
            <Input
              label="Имя"
              placeholder="Например, Fabric Performance"
              value={name}
              error={nameError}
              hint={
                iconPath === null
                  ? 'Иконка необязательна — иначе берутся инициалы.'
                  : `Иконка: ${iconPath.split(/[\\/]/).pop() ?? iconPath}`
              }
              autoFocus
              onChange={(event) => {
                setName(event.target.value);
              }}
              onBlur={() => {
                setNameTouched(true);
              }}
              trailing={
                iconPath === null ? undefined : (
                  <IconButton
                    label="Убрать иконку"
                    size="sm"
                    icon={<X size={13} strokeWidth={1.5} />}
                    onClick={() => {
                      setIconPath(null);
                    }}
                  />
                )
              }
            />
          </div>
        </div>

        <Select
          label="Версия Minecraft"
          value={mcVersion}
          options={
            versionOptions.length > 0
              ? versionOptions
              : [{ value: '', label: loadingVersions ? 'Загрузка…' : 'Нет версий' }]
          }
          disabled={loadingVersions || versionOptions.length === 0}
          onChange={setMcVersion}
        />

        <Switch
          checked={showSnapshots}
          onChange={setShowSnapshots}
          label="Показывать снапшоты"
          description="Экспериментальные сборки Mojang между релизами."
        />

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Модлоадер"
            value={loader}
            options={loaderOptions}
            onChange={(value) => {
              setLoader(value);
            }}
          />

          <Select
            label="Версия лоадера"
            value={loaderVersion ?? ''}
            disabled={loader === 'vanilla' || loadingLoader || loaderVersionOptions.length === 0}
            options={
              loader === 'vanilla'
                ? [{ value: '', label: 'Не требуется' }]
                : loaderVersionOptions.length > 0
                  ? loaderVersionOptions
                  : [{ value: '', label: loadingLoader ? 'Загрузка…' : 'Нет сборок' }]
            }
            onChange={(value) => {
              setLoaderVersion(value === '' ? null : value);
            }}
            {...(loaderError === null ? {} : { hint: loaderError })}
          />
        </div>
      </div>
    </Dialog>
  );
}
