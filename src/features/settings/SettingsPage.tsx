import { useState } from 'react';
import type { ReactElement } from 'react';
import { Coffee, ExternalLink, Eye, EyeOff, Palette } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Section } from '@/components/ui/Section';
import { Skeleton } from '@/components/ui/Skeleton';
import { Slider } from '@/components/ui/Slider';
import { Switch } from '@/components/ui/Switch';
import * as metaApi from '@/api/meta';
import { openExternal } from '@/api/system';
import { useAsyncData } from '@/lib/useAsyncData';
import type { JavaRuntime } from '@/types/java';
import { useSettings } from '@/store/useSettings';
import { useUI } from '@/store/useUI';

/** Microsoft's own guide; the Minecraft approval form is linked from the README. */
const AZURE_GUIDE_URL =
  'https://learn.microsoft.com/entra/identity-platform/quickstart-register-app';


export function SettingsPage(): ReactElement {
  const settings = useSettings((state) => state.settings);
  const patch = useSettings((state) => state.patch);
  const keyBuiltin = useSettings((state) => state.curseforgeKeyBuiltin);
  const navigate = useUI((state) => state.navigate);
  const [showKey, setShowKey] = useState(false);

  const java = useAsyncData<JavaRuntime[]>(() => metaApi.listJavaRuntimes(), []);

  return (
    <div className="flex h-full flex-col">
      <header className="hairline-b flex h-14 shrink-0 items-center px-6">
        <h1 className="text-sm font-semibold text-text">Настройки</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="flex max-w-[720px] flex-col gap-3">
          <Section
            title="Внешний вид"
            description="Тема, цвет акцента, обои, талисман в углу и масштаб интерфейса."
          >
            <div>
              <Button
                icon={<Palette size={14} strokeWidth={1.5} />}
                onClick={() => {
                  navigate({ name: 'appearance' });
                }}
              >
                Открыть «Оформление»
              </Button>
            </div>
          </Section>

          <Section
            title="Java по умолчанию"
            description="Значения применяются к новым сборкам и к тем, где не заданы свои."
          >
            <Slider
              label="Оперативная память"
              value={settings.defaultMemoryMb}
              min={1024}
              max={32_768}
              step={256}
              valueLabel={`${String(settings.defaultMemoryMb)} МБ`}
              onChange={(value) => {
                void patch({ defaultMemoryMb: value });
              }}
            />

            <Input
              label="Аргументы JVM"
              monospace
              value={settings.defaultJvmArgs}
              onChange={(event) => {
                void patch({ defaultJvmArgs: event.target.value });
              }}
            />
          </Section>

          <Section
            title="Найденные среды Java"
            description="Лаунчер сам подбирает нужную версию, а недостающую скачивает с Adoptium."
          >
            {java.loading ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 2 }, (_, index) => (
                  <Skeleton key={index} className="h-11" />
                ))}
              </div>
            ) : (java.data ?? []).length === 0 ? (
              <p className="text-2xs text-text-dim">Установленных JDK не найдено.</p>
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
                        {runtime.source === 'managed' && <Badge tone="accent">скачана</Badge>}
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
            title="Сеть и источники"
            description={
              keyBuiltin
                ? 'Modrinth и CurseForge подключены.'
                : 'CurseForge требует ключ API. Пока поле пустое, источник скрыт в браузере модов.'
            }
          >
            <Slider
              label="Параллельных загрузок"
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
                label="Ключ CurseForge API"
                type={showKey ? 'text' : 'password'}
                monospace
                autoComplete="off"
                placeholder="не задан"
                value={settings.curseforgeApiKey}
                onChange={(event) => {
                  void patch({ curseforgeApiKey: event.target.value });
                }}
                trailing={
                  <IconButton
                    label={showKey ? 'Скрыть ключ' : 'Показать ключ'}
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
                hint="Хранится только на этом компьютере, в settings.json."
              />
            )}

            <Input
              label="Контакт для User-Agent"
              type="email"
              placeholder="you@example.com"
              value={settings.contactEmail}
              onChange={(event) => {
                void patch({ contactEmail: event.target.value });
              }}
              hint="Modrinth и CurseForge требуют контакт в User-Agent. Без него запросы могут ограничиваться."
            />
          </Section>

          <Section
            title="Вход через Microsoft"
            description="Нужен Client ID приложения Azure, одобренного Mojang для Minecraft API. Если поле пустое, используется ID, заданный при сборке лаунчера."
          >
            <Input
              label="Client ID приложения Azure"
              monospace
              autoComplete="off"
              spellCheck={false}
              placeholder="00000000-0000-0000-0000-000000000000"
              value={settings.msaClientId}
              onChange={(event) => {
                void patch({ msaClientId: event.target.value.trim() });
              }}
              hint="Хранится только на этом компьютере. Токены входа лежат в системном хранилище паролей, не в файлах лаунчера."
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
                Как зарегистрировать приложение
              </Button>
            </div>
          </Section>

          <Section title="Поведение">
            <Switch
              checked={settings.closeLauncherOnLaunch}
              onChange={(value) => {
                void patch({ closeLauncherOnLaunch: value });
              }}
              label="Сворачивать лаунчер при запуске игры"
            />
            <Switch
              checked={settings.showSnapshots}
              onChange={(value) => {
                void patch({ showSnapshots: value });
              }}
              label="Показывать снапшоты в списке версий"
            />
          </Section>

          <Section
            title="Папка данных"
            description="Пусто — используется стандартный путь операционной системы."
          >
            <Input
              monospace
              placeholder="%APPDATA%\FirLauncher"
              value={settings.dataDirOverride}
              onChange={(event) => {
                void patch({ dataDirOverride: event.target.value });
              }}
              hint="Изменение вступит в силу после перезапуска лаунчера."
            />
          </Section>
        </div>
      </div>
    </div>
  );
}
