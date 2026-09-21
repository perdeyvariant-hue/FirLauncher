import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { SelectOption } from '@/components/ui/Select';
import { Slider } from '@/components/ui/Slider';
import { Switch } from '@/components/ui/Switch';
import * as metaApi from '@/api/meta';
import { useAsyncData } from '@/lib/useAsyncData';
import type { JavaRuntime, SystemMemory } from '@/types/java';
import type { Instance, InstanceJavaSettings } from '@/types/instance';
import { useInstances } from '@/store/useInstances';
import { useSettings } from '@/store/useSettings';

const AUTO = '__auto__';
const MEMORY_STEP_MB = 256;

interface JavaEnvironment {
  readonly runtimes: readonly JavaRuntime[];
  readonly memory: SystemMemory;
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactElement | ReactElement[];
}): ReactElement {
  return (
    <section className="panel flex flex-col gap-4 p-4">
      <div>
        <h3 className="text-xs font-semibold text-text">{title}</h3>
        {description !== undefined && (
          <p className="mt-1 text-2xs leading-relaxed text-text-dim">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

export function InstanceSettingsTab({ instance }: { instance: Instance }): ReactElement {
  const save = useInstances((state) => state.save);
  const defaults = useSettings((state) => state.settings);

  const { data } = useAsyncData<JavaEnvironment>(
    async () => ({
      runtimes: await metaApi.listJavaRuntimes(),
      memory: await metaApi.systemMemory(),
    }),
    [],
  );

  const [draft, setDraft] = useState<InstanceJavaSettings>(instance.java);

  // Switching instance must not carry the previous draft over.
  useEffect(() => {
    setDraft(instance.java);
  }, [instance.id, instance.java]);

  const patch = (next: Partial<InstanceJavaSettings>): void => {
    const merged: InstanceJavaSettings = { ...draft, ...next };
    setDraft(merged);
    void save({ ...instance, java: merged });
  };

  const maxMemoryMb = data?.memory.totalMb ?? 16_384;
  const effectiveMemory = draft.memoryMb ?? defaults.defaultMemoryMb;

  const javaOptions: SelectOption<string>[] = [
    { value: AUTO, label: 'Автоматически по версии игры' },
    ...(data?.runtimes ?? []).map((runtime) => ({
      value: runtime.path,
      label: `Java ${String(runtime.major)} · ${runtime.vendor} ${runtime.fullVersion}`,
    })),
  ];

  const envEntries = Object.entries(draft.env);

  return (
    <div className="flex flex-col gap-3">
      <Section
        title="Java"
        description="Пусто — лаунчер сам подберёт JDK: 8 для версий ≤1.16, 17 для 1.17–1.20.4, 21 для 1.20.5 и новее."
      >
        <Select
          label="Среда выполнения"
          value={draft.javaPath ?? AUTO}
          options={javaOptions}
          onChange={(value) => {
            patch({ javaPath: value === AUTO ? null : value });
          }}
        />

        <Slider
          label="Оперативная память"
          value={effectiveMemory}
          min={1024}
          max={maxMemoryMb}
          step={MEMORY_STEP_MB}
          valueLabel={`${String(effectiveMemory)} МБ`}
          marks={[
            {
              at: (defaults.defaultMemoryMb - 1024) / Math.max(maxMemoryMb - 1024, 1),
              title: 'Значение по умолчанию',
            },
          ]}
          onChange={(value) => {
            patch({ memoryMb: value });
          }}
        />

        <Switch
          checked={draft.memoryMb === null}
          onChange={(checked) => {
            patch({ memoryMb: checked ? null : defaults.defaultMemoryMb });
          }}
          label="Использовать глобальное значение"
          description={`Сейчас в настройках: ${String(defaults.defaultMemoryMb)} МБ.`}
        />

        <Input
          label="Дополнительные аргументы JVM"
          monospace
          placeholder={defaults.defaultJvmArgs}
          value={draft.extraJvmArgs ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            setDraft((current) => ({ ...current, extraJvmArgs: value === '' ? null : value }));
          }}
          onBlur={() => {
            patch({ extraJvmArgs: draft.extraJvmArgs });
          }}
          hint="Пусто — берутся аргументы из глобальных настроек."
        />
      </Section>

      <Section title="Окно игры" description="Размер окна при запуске.">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Ширина"
            type="number"
            min={640}
            value={String(draft.window?.width ?? 854)}
            disabled={draft.window === null}
            onChange={(event) => {
              const width = Number(event.target.value);
              patch({
                window: {
                  width,
                  height: draft.window?.height ?? 480,
                  fullscreen: draft.window?.fullscreen ?? false,
                },
              });
            }}
          />
          <Input
            label="Высота"
            type="number"
            min={480}
            value={String(draft.window?.height ?? 480)}
            disabled={draft.window === null}
            onChange={(event) => {
              const height = Number(event.target.value);
              patch({
                window: {
                  width: draft.window?.width ?? 854,
                  height,
                  fullscreen: draft.window?.fullscreen ?? false,
                },
              });
            }}
          />
        </div>

        <Switch
          checked={draft.window !== null}
          onChange={(checked) => {
            patch({ window: checked ? { width: 854, height: 480, fullscreen: false } : null });
          }}
          label="Задать размер окна"
        />

        <Switch
          checked={draft.window?.fullscreen ?? false}
          disabled={draft.window === null}
          onChange={(checked) => {
            patch({
              window: {
                width: draft.window?.width ?? 854,
                height: draft.window?.height ?? 480,
                fullscreen: checked,
              },
            });
          }}
          label="Полноэкранный режим"
        />
      </Section>

      <Section
        title="Переменные окружения"
        description="Передаются процессу игры. Например, __GL_THREADED_OPTIMIZATIONS=1 на Linux."
      >
        <div className="flex flex-col gap-2">
          {envEntries.length === 0 && (
            <p className="text-2xs text-text-dim">Переменные не заданы.</p>
          )}

          {envEntries.map(([key, value]) => (
            <div key={key} className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  monospace
                  value={key}
                  readOnly
                  aria-label={`Имя переменной ${key}`}
                />
              </div>
              <div className="flex-1">
                <Input
                  monospace
                  value={value}
                  aria-label={`Значение ${key}`}
                  onChange={(event) => {
                    patch({ env: { ...draft.env, [key]: event.target.value } });
                  }}
                />
              </div>
              <IconButton
                label={`Удалить ${key}`}
                tone="danger"
                icon={<Trash2 size={14} strokeWidth={1.5} />}
                onClick={() => {
                  patch({
                    env: Object.fromEntries(
                      Object.entries(draft.env).filter(([name]) => name !== key),
                    ),
                  });
                }}
              />
            </div>
          ))}

          <div>
            <Button
              size="sm"
              icon={<Plus size={13} strokeWidth={1.5} />}
              onClick={() => {
                let name = 'NEW_VAR';
                let suffix = 1;
                while (name in draft.env) {
                  suffix += 1;
                  name = `NEW_VAR_${String(suffix)}`;
                }
                patch({ env: { ...draft.env, [name]: '' } });
              }}
            >
              Добавить переменную
            </Button>
          </div>
        </div>
      </Section>
    </div>
  );
}
