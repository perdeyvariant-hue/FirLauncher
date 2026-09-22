import { useState } from 'react';
import type { ReactElement } from 'react';
import { Coffee, ExternalLink, Eye, EyeOff, Palette, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Section } from '@/components/ui/Section';
import { Skeleton } from '@/components/ui/Skeleton';
import { Slider } from '@/components/ui/Slider';
import { Switch } from '@/components/ui/Switch';
import * as metaApi from '@/api/meta';
import * as updatesApi from '@/api/updates';
import { openExternal } from '@/api/system';
import { useAsyncData } from '@/lib/useAsyncData';
import type { JavaRuntime } from '@/types/java';
import { useSettings } from '@/store/useSettings';
import { useUI } from '@/store/useUI';
import { useUpdater } from '@/store/useUpdater';
import { t } from '@/lib/i18n';

const REPO_URL = 'https://github.com/perdeyvariant-hue/FirLauncher';

/** Microsoft's own guide; the Minecraft approval form is linked from the README. */
const AZURE_GUIDE_URL =
  'https://learn.microsoft.com/entra/identity-platform/quickstart-register-app';


export function SettingsPage(): ReactElement {
  const settings = useSettings((state) => state.settings);
  const patch = useSettings((state) => state.patch);
  const keyBuiltin = useSettings((state) => state.curseforgeKeyBuiltin);
  const navigate = useUI((state) => state.navigate);
  const discordBuiltin = useSettings((state) => state.discordAppIdBuiltin);
  const [showKey, setShowKey] = useState(false);

  const java = useAsyncData<JavaRuntime[]>(() => metaApi.listJavaRuntimes(), []);
  const version = useAsyncData<string>(() => updatesApi.appVersion(), []);
  const updaterPhase = useUpdater((state) => state.phase);
  const checkUpdates = useUpdater((state) => state.check);

  return (
    <div className="flex h-full flex-col">
      <header className="hairline-b flex h-14 shrink-0 items-center px-6">
        <h1 className="text-sm font-semibold text-text">{t`Настройки`}</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="flex max-w-[720px] flex-col gap-3">
          <Section
            title={t`Внешний вид`}
            description={t`Тема, цвет акцента, обои, талисман в углу и масштаб интерфейса.`}
          >
            <div>
              <Button
                icon={<Palette size={14} strokeWidth={1.5} />}
                onClick={() => {
                  navigate({ name: 'appearance' });
                }}
              >
                {t`Открыть «Оформление»`}</Button>
            </div>
          </Section>

          <Section
            title={t`Java по умолчанию`}
            description={t`Значения применяются к новым сборкам и к тем, где не заданы свои.`}
          >
            <Slider
              label={t`Оперативная память`}
              value={settings.defaultMemoryMb}
              min={1024}
              max={32_768}
              step={256}
              valueLabel={t`${String(settings.defaultMemoryMb)} МБ`}
              onChange={(value) => {
                void patch({ defaultMemoryMb: value });
              }}
            />

            <Input
              label={t`Аргументы JVM`}
              monospace
              value={settings.defaultJvmArgs}
              onChange={(event) => {
                void patch({ defaultJvmArgs: event.target.value });
              }}
            />
          </Section>

          <Section
            title={t`Найденные среды Java`}
            description={t`Лаунчер сам подбирает нужную версию, а недостающую скачивает с Adoptium.`}
          >
            {java.loading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 2 }, (_, index) => (
                  <Skeleton key={index} className="h-11" />
                ))}
              </div>
            ) : (java.data ?? []).length === 0 ? (
              <p className="text-2xs text-text-dim">{t`Установленных JDK не найдено.`}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {(java.data ?? []).map((runtime) => (
                  <li
                    key={runtime.path}
                    className="flex items-center gap-3 rounded-md bg-surface-2 p-2.5"
                  >
                    <Coffee size={15} strokeWidth={1.5} className="shrink-0 text-text-dim" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-text">Java {runtime.major}</span>
                        <Badge tone="outline">{runtime.vendor}</Badge>
                        {runtime.source === 'managed' && <Badge tone="accent">{t`скачана`}</Badge>}
                      </div>
                      <p className="mt-0.5 truncate font-mono text-2xs text-text-dim">
                        {runtime.path}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title={t`Сеть и источники`}
            description={
              keyBuiltin
                ? t`Modrinth и CurseForge подключены.`
                : t`CurseForge требует ключ API. Пока поле пустое, источник скрыт в браузере модов.`
            }
          >
            <Slider
              label={t`Параллельных загрузок`}
              value={settings.maxConcurrentDownloads}
              min={1}
              max={32}
              step={1}
              valueLabel={String(settings.maxConcurrentDownloads)}
              onChange={(value) => {
                void patch({ maxConcurrentDownloads: value });
              }}
            />

            {!keyBuiltin && (
              <Input
                label={t`Ключ CurseForge API`}
                type={showKey ? 'text' : 'password'}
                monospace
                autoComplete="off"
                placeholder={t`не задан`}
                value={settings.curseforgeApiKey}
                onChange={(event) => {
                  void patch({ curseforgeApiKey: event.target.value });
                }}
                trailing={
                  <IconButton
                    label={showKey ? t`Скрыть ключ` : t`Показать ключ`}
                    size="sm"
                    icon={
                      showKey ? (
                        <EyeOff size={13} strokeWidth={1.5} />
                      ) : (
                        <Eye size={13} strokeWidth={1.5} />
                      )
                    }
                    onClick={() => {
                      setShowKey((value) => !value);
                    }}
                  />
                }
                hint={t`Хранится только на этом компьютере, в settings.json.`}
              />
            )}

            <Input
              label={t`Контакт для User-Agent`}
              type="email"
              placeholder="you@example.com"
              value={settings.contactEmail}
              onChange={(event) => {
                void patch({ contactEmail: event.target.value });
              }}
              hint={t`Modrinth и CurseForge требуют контакт в User-Agent. Без него запросы могут ограничиваться.`}
            />
          </Section>

          <Section
            title={t`Вход через Microsoft`}
            description={t`Нужен Client ID приложения Azure, одобренного Mojang для Minecraft API. Если поле пустое, используется ID, заданный при сборке лаунчера.`}
          >
            <Input
              label={t`Client ID приложения Azure`}
              monospace
              autoComplete="off"
              spellCheck={false}
              placeholder="00000000-0000-0000-0000-000000000000"
              value={settings.msaClientId}
              onChange={(event) => {
                void patch({ msaClientId: event.target.value.trim() });
              }}
              hint={t`Хранится только на этом компьютере. Токены входа лежат в системном хранилище паролей, не в файлах лаунчера.`}
            />
            <div>
              <Button
                size="sm"
                variant="ghost"
                icon={<ExternalLink size={13} strokeWidth={1.5} />}
                onClick={() => {
                  void openExternal(AZURE_GUIDE_URL);
                }}
              >
                {t`Как зарегистрировать приложение`}</Button>
            </div>
          </Section>

          <Section title={t`Поведение`}>
            <Switch
              checked={settings.closeLauncherOnLaunch}
              onChange={(value) => {
                void patch({ closeLauncherOnLaunch: value });
              }}
              label={t`Сворачивать лаунчер при запуске игры`}
            />
            <Switch
              checked={settings.showSnapshots}
              onChange={(value) => {
                void patch({ showSnapshots: value });
              }}
              label={t`Показывать снапшоты в списке версий`}
            />
            <Switch
              checked={settings.backupWorldsBeforeUpdates}
              onChange={(value) => {
                void patch({ backupWorldsBeforeUpdates: value });
              }}
              label={t`Резервная копия миров перед обновлениями`}
              description={t`Перед обновлением модов или модпака лаунчер сохраняет копии всех миров сборки (последние 3 на мир).`}
            />
          </Section>

          <Section
            title={t`Папка данных`}
            description={t`Пусто — используется стандартный путь операционной системы.`}
          >
            <Input
              monospace
              placeholder="%APPDATA%\FirLauncher"
              value={settings.dataDirOverride}
              onChange={(event) => {
                void patch({ dataDirOverride: event.target.value });
              }}
              hint={t`Изменение вступит в силу после перезапуска лаунчера.`}
            />
          </Section>

          <Section
            title="Discord"
            description={t`Пока идёт игра, в профиле Discord видно: «Играет в <сборка> · Minecraft 1.21.1 Fabric».`}
          >
            <Switch
              checked={settings.discordPresence}
              onChange={(value) => {
                void patch({ discordPresence: value });
              }}
              label={t`Показывать игру в статусе Discord`}
            />
            {!discordBuiltin && (
              <Input
                label="Discord Application ID"
                monospace
                placeholder={t`например, 1234567890123456789`}
                value={settings.discordAppId}
                onChange={(event) => {
                  void patch({ discordAppId: event.target.value.trim() });
                }}
                hint={t`Создайте приложение на discord.com/developers/applications и вставьте его ID. Картинка статуса — ассет с именем logo в разделе Rich Presence.`}
              />
            )}
          </Section>

          <Section
            title={t`О программе`}
            description={t`Обновления приходят с GitHub и проверяются по цифровой подписи перед установкой.`}
          >
            <div className="flex items-center gap-3">
              <span className="text-xs text-text">
                FirLauncher <span className="font-mono">{version.data ?? '…'}</span>
              </span>
              <Button
                size="sm"
                loading={updaterPhase === 'checking'}
                icon={<RefreshCw size={13} strokeWidth={1.5} />}
                onClick={() => {
                  void checkUpdates(false);
                }}
              >
                {t`Проверить обновления`}</Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<ExternalLink size={13} strokeWidth={1.5} />}
                onClick={() => {
                  void openExternal(REPO_URL);
                }}
              >
                GitHub
              </Button>
            </div>
            <Switch
              checked={settings.checkForUpdates}
              onChange={(value) => {
                void patch({ checkForUpdates: value });
              }}
              label={t`Проверять обновления при запуске`}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
