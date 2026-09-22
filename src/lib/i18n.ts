import { EN } from '@/locales/en';

/**
 * Interface language. Russian source strings are the keys: `t` looks them up
 * in the English dictionary and falls back to Russian, so a missing entry is
 * never a blank. Switching language reloads the page — strings are resolved
 * once, even in module-level constants.
 *
 *   t`Сборки`                     plain text
 *   t`Установлено: ${name}`       placeholders become {0}, {1}… in the key
 *   translate(message)            text that arrived from the backend
 */

export type Language = 'ru' | 'en';
export type LanguageSetting = Language | 'system';

const STORAGE_KEY = 'firlauncher.language';

function systemLanguage(): Language {
  const code = typeof navigator === 'undefined' ? 'ru' : navigator.language.toLowerCase();
  return code.startsWith('ru') || code.startsWith('uk') || code.startsWith('be') || code.startsWith('kk')
    ? 'ru'
    : 'en';
}

function readSetting(): LanguageSetting {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'ru' || stored === 'en' || stored === 'system') return stored;
  } catch {
    // Storage unavailable: follow the system.
  }
  return 'system';
}

const setting: LanguageSetting = readSetting();
export const language: Language = setting === 'system' ? systemLanguage() : setting;

/** The locale for dates and numbers. */
export const locale: string = language === 'ru' ? 'ru-RU' : 'en-US';

export function languageSetting(): LanguageSetting {
  return setting;
}

/** Saves the choice and reloads, so every string is resolved again. */
export function setLanguage(next: LanguageSetting): void {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Without storage the choice lasts until restart.
  }
  window.location.reload();
}

type Value = string | number;

function fill(template: string, values: readonly Value[]): string {
  return template.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = values[Number(index)];
    return value === undefined ? match : String(value);
  });
}

function lookup(key: string): string {
  if (language === 'ru') return key;
  return EN[key] ?? key;
}

/** Tagged template: t`Текст ${x}` → the translation with x filled in. */
export function t(strings: TemplateStringsArray | string, ...values: readonly Value[]): string {
  if (typeof strings === 'string') return lookup(strings);
  let key = strings[0] ?? '';
  for (let index = 1; index < strings.length; index += 1) {
    key += `{${String(index - 1)}}${strings[index] ?? ''}`;
  }
  return fill(lookup(key), values);
}

/* ——— Backend messages ——— */

interface Pattern {
  readonly regex: RegExp;
  readonly template: string;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let patterns: Pattern[] | null = null;

/** Dictionary keys with placeholders, as regexes that capture the values. */
function compiledPatterns(): Pattern[] {
  if (patterns !== null) return patterns;
  patterns = Object.entries(EN)
    .filter(([key]) => /\{\d+\}/.test(key))
    .map(([key, template]) => ({
      regex: new RegExp(
        `^${key
          .split(/(\{\d+\})/)
          .map((part) => (/^\{\d+\}$/.test(part) ? '([\\s\\S]*?)' : escapeRegex(part)))
          .join('')}$`,
      ),
      template,
    }))
    // Longer keys are more specific; try them first.
    .sort((a, b) => b.regex.source.length - a.regex.source.length);
  return patterns;
}

/**
 * Translates a finished sentence that came from the backend (errors, task
 * stages, crash diagnoses), including ones with names or numbers inside.
 */
export function translate(message: string): string {
  if (language === 'ru' || message === '') return message;
  const exact = EN[message];
  if (exact !== undefined) return exact;
  for (const { regex, template } of compiledPatterns()) {
    const match = regex.exec(message);
    if (match !== null) return fill(template, match.slice(1).map((value) => translate(value)));
  }
  return message;
}
