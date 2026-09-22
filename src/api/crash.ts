import type { CrashAnalysis, CrashFix } from '@/types/crash';
import { ipc, mocked, shouldMock } from './shared';
import { t } from '@/lib/i18n';

export function diagnoseCrash(instanceId: string): Promise<CrashAnalysis> {
  if (shouldMock()) {
    return mocked<CrashAnalysis>(
      {
        diagnoses: [
          {
            rule: 'missing-dependency',
            title: t`Не хватает модов: fabric-api`,
            explanation:
              t`Одному из модов нужны другие, а их нет в папке mods. Лаунчер найдёт их на Modrinth под версию и лоадер этой сборки.`,
            fix: { type: 'installMods', modIds: ['fabric-api'] },
          },
          {
            rule: 'java-too-old',
            title: t`Нужна Java 21`,
            explanation: t`Мод собран под Java 21, а сборка запускалась на Java 17.`,
            fix: { type: 'useJava', major: 21 },
          },
        ],
        excerpt: ['java.lang.RuntimeException: Mod resolution failed'],
        exitCode: 1,
        crashReport: null,
      },
      400,
    );
  }
  return ipc<CrashAnalysis>('diagnose_crash', { instanceId });
}

/** Applies a fix; resolves with a line for the confirmation toast. */
export function applyCrashFix(instanceId: string, fix: CrashFix): Promise<string> {
  if (shouldMock()) return mocked(t`Готово`, 600);
  return ipc<string>('apply_crash_fix', { instanceId, fix });
}
