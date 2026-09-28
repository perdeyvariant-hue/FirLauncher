import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Slider } from '@/components/ui/Slider';
import { Switch } from '@/components/ui/Switch';
import { Page } from '@/components/layout/PageHeader';
import * as metaApi from '@/api/meta';
import * as updatesApi from '@/api/updates';
import { openExternal } from '@/api/system';
import { useAsyncData } from '@/lib/useAsyncData';
import type { JavaRuntime, SystemMemory } from '@/types/java';
import { useSettings } from '@/store/useSettings';
import { useUpdater } from '@/store/useUpdater';
import { locale, t } from '@/lib/i18n';
import { StorageSection } from './StorageSection';

const REPO_URL = 'https://github.com/perdeyvariant-hue/FirLauncher';

/** Which Minecraft versions a Java major is the one for. */
function javaFor(major: number): string {
  if (major >= 21) return t`для 1.20.5+`;
  if (major >= 17) return t`для 1.18–1.20.4`;
  if (major === 16) return t`для 1.17`;
  if (major <= 8) return t`для 1.16.5 и старше`;
  return t`Java ${String(major)}`;
}

function Card({
  title,
  aside,
  children,
  className,
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <section className={className ?? 'glass rounded-xl p-[18px]'}>
      {title !== undefined && (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-text">{title}</h2>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <label className="mt-3.5 block">
      <span className="mb-1.5 block text-[13px] text-text-dim">{label}</span>
      {children}
      {hint !== undefined && <span className="mt-1.5 block text-xs text-text-faint">{hint}</span>}
    </label>
  );
}

const FIELD =
  'field w-full rounded-[12px] px-3 font-mono text-[12.5px] text-text outline-none placeholder:text-text-faint focus:shadow-[inset_0_0_0_1px_var(--glass-border),0_0_0_3px_rgb(var(--accent-rgb)/0.35)]';

export function SettingsPage(): ReactElement {
  const settings = useSettings((state) => state.settings);
  const patch = useSettings((state) => state.patch);
  const keyBuiltin = useSettings((state) => state.curseforgeKeyBuiltin);
  const discordBuiltin = useSettings((state) => state.discordAppIdBuiltin);

  const java = useAsyncData<JavaRuntime[]>(() => metaApi.listJavaRuntimes(), []);
  const memory = useAsyncData<SystemMemory>(() => metaApi.systemMemory(), []);
  const version = useAsyncData<string>(() => updatesApi.appVersion(), []);
  const updaterPhase = useUpdater((state) => state.phase);
  const checkUpdates = useUpdater((state) => state.check);
  const [checked, setChecked] = useState(false);

  const totalMb = memory.data?.totalMb ?? 32_768;
  const ramMax = Math.max(4096, Math.floor(totalMb / 512) * 512);
  const gb = (mb: number): string =>
    (mb / 1024).toLocaleString(locale, { maximumFractionDigits: 1 });

  const updateStatus =
    updaterPhase === 'checking'
      ? t`Проверяем…`
      : updaterPhase === 'available'
        ? t`Есть новая версия — кнопка обновления сверху`
        : updaterPhase === 'failed'
          ? t`Не удалось проверить`
          : checked
            ? t`Установлена последняя версия`
            : t`Версия ${version.data ?? '…'}`;

  return (
    <Page title={t`Настройки`} subtitle={version.data === null ? undefined : `FirLauncher ${version.data}`}>
      <div className="mt-2 grid grid-cols-2 items-start gap-3.5">
        <div className="flex flex-col gap-3.5">
          <Card title={t`Java и память`}>
            <Slider
              label={t`Выделенная память`}
              value={Math.min(settings.defaultMemoryMb, ramMax)}
              min={1024}
              max={ramMax}
              step={512}
              valueLabel={t`${settings.defaultMemoryMb.toLocaleString(locale)} МБ`}
              valueHint={t`≈ ${gb(settings.defaultMemoryMb)} ГБ из ${gb(totalMb)} ГБ`}
              onChange={(value) => {
                void patch({ defaultMemoryMb: value });
              }}
            />
            <Field label={t`Аргументы JVM`}>
              <textarea
                rows={2}
                spellCheck={false}
                value={settings.defaultJvmArgs}
                onChange={(event) => {
                  void patch({ defaultJvmArgs: event.target.value });
                }}
                className={`${FIELD} resize-none py-2.5 leading-normal`}
              />
            </Field>
            <p className="mb-1.5 mt-3.5 text-[13px] text-text-dim">{t`Установленные версии Java`}</p>
            {java.loading ? (
              <Skeleton className="h-24" />
            ) : (java.data ?? []).length === 0 ? (
              <p className="rounded-[14px] bg-[var(--chip)] p-3 text-xs text-text-faint">
                {t`Установленных JDK не найдено — нужная скачается сама при первом запуске.`}
              </p>
            ) : (
              <div className="flex flex-col overflow-hidden rounded-[14px] bg-[var(--chip)]">
                {(java.data ?? []).map((runtime) => (
                  <div key={runtime.path} className="px-3 py-2.5 shadow-[inset_0_-1px_0_var(--sep)] last:shadow-none">
                    <div className="flex items-center gap-2 text-[13px] font-semibold text-text">
                      Java {runtime.fullVersion || runtime.major}
                      <span className="text-[11px] font-medium text-text-faint">
                        {runtime.vendor} · {javaFor(runtime.major)}
                        {runtime.source === 'managed' && t` · скачана лаунчером`}
                      </span>
                    </div>
                    <p className="mt-[3px] truncate font-mono text-[11px] text-text-faint" title={runtime.path}>
                      {runtime.path}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title={t`Загрузки`}>
            <Slider
              label={t`Параллельные загрузки`}
              value={settings.maxConcurrentDownloads}
              min={1}
              max={32}
              step={1}
              valueLabel={t`${String(settings.maxConcurrentDownloads)} потоков`}
              onChange={(value) => {
                void patch({ maxConcurrentDownloads: value });
              }}
            />
            <Field
              label={t`Контакт для API Modrinth и CurseForge`}
              hint={
                keyBuiltin
                  ? t`Оба сервиса просят указать контакт в User-Agent. Без него запросы могут ограничиваться.`
                  : t`В этой сборке лаунчера нет ключа CurseForge — доступен только Modrinth.`
              }
            >
              <input
                type="email"
                placeholder="you@example.com"
                value={settings.contactEmail}
                onChange={(event) => {
                  void patch({ contactEmail: event.target.value });
                }}
                className={`${FIELD} h-[34px]`}
              />
            </Field>
          </Card>
        </div>

        <div className="flex flex-col gap-3.5">
          <Card className="glass rounded-xl px-[18px] py-1.5">
            <div className="py-3">
              <Switch
                checked={settings.closeLauncherOnLaunch}
                onChange={(value) => {
                  void patch({ closeLauncherOnLaunch: value });
                }}
                label={t`Сворачивать при запуске игры`}
              />
            </div>
            <div className="py-3 shadow-[inset_0_1px_0_var(--sep)]">
              <Switch
                checked={settings.showSnapshots}
                onChange={(value) => {
                  void patch({ showSnapshots: value });
                }}
                label={t`Показывать снапшоты`}
                description={t`Экспериментальные версии в списке`}
              />
            </div>
            <div className="py-3 shadow-[inset_0_1px_0_var(--sep)]">
              <Switch
                checked={settings.backupWorldsBeforeUpdates}
                onChange={(value) => {
                  void patch({ backupWorldsBeforeUpdates: value });
                }}
                label={t`Резервные копии миров`}
                description={t`Перед обновлением модов и модпаков, последние 3 на мир`}
              />
            </div>
            <div className="py-3 shadow-[inset_0_1px_0_var(--sep)]">
              <Switch
                checked={settings.discordPresence}
                onChange={(value) => {
                  void patch({ discordPresence: value });
                }}
                label={t`Статус в Discord`}
                description={t`«Играет в <сборка> · Minecraft 1.21.1 Fabric»`}
              />
              {!discordBuiltin && settings.discordPresence && (
                <input
                  placeholder={t`Discord Application ID`}
                  value={settings.discordAppId}
                  onChange={(event) => {
                    void patch({ discordAppId: event.target.value.trim() });
                  }}
                  className={`${FIELD} mt-2.5 h-[34px]`}
                />
              )}
            </div>
          </Card>

          <StorageSection />

          <Card className="glass flex items-center gap-3 rounded-xl px-[18px] py-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-text">{t`Обновления`}</p>
              <p
                className={
                  checked && updaterPhase === 'idle'
                    ? 'mt-[3px] text-xs text-success'
                    : 'mt-[3px] text-xs text-text-faint'
                }
              >
                {updateStatus}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              icon={<ExternalLink size={13} strokeWidth={1.8} />}
              onClick={() => {
                void openExternal(REPO_URL);
              }}
            >
              GitHub
            </Button>
            <Button
              size="sm"
              loading={updaterPhase === 'checking'}
              onClick={() => {
                void Promise.resolve(checkUpdates(false)).then(() => {
                  setChecked(true);
                });
              }}
            >
              {t`Проверить`}
            </Button>
          </Card>
          <div className="px-1">
            <Switch
              checked={settings.checkForUpdates}
              onChange={(value) => {
                void patch({ checkForUpdates: value });
              }}
              label={t`Проверять обновления при запуске`}
            />
          </div>
        </div>
      </div>
    </Page>
  );
}
