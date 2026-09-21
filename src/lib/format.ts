const BYTE_UNITS = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'] as const;

export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б';
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const unit = BYTE_UNITS[exponent] ?? 'Б';
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : fractionDigits)} ${unit}`;
}

export function formatSpeed(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null || bytesPerSecond <= 0) return '—';
  return `${formatBytes(bytesPerSecond, 1)}/с`;
}

/** "12 ч 30 мин", "45 мин", "меньше минуты" */
export function formatPlaytime(totalSeconds: number): string {
  if (totalSeconds < 60) return 'меньше минуты';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours === 0) return `${minutes} мин`;
  if (minutes === 0) return `${hours} ч`;
  return `${hours} ч ${minutes} мин`;
}

/** "сегодня", "вчера", "3 дня назад", "12.03.2025" */
export function formatRelativeDate(iso: string | null): string {
  if (iso === null) return 'никогда';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'никогда';

  const dayMs = 86_400_000;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.floor((startOfToday.getTime() - then.setHours(0, 0, 0, 0)) / dayMs);

  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} дн. назад`;
  return new Date(iso).toLocaleDateString('ru-RU');
}

export function formatCompactNumber(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}K`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

/** Deterministic accent-neutral initials for instances without an icon. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (first === undefined) return '?';
  const second = words[1];
  if (second === undefined) return first.slice(0, 2).toUpperCase();
  return `${first.slice(0, 1)}${second.slice(0, 1)}`.toUpperCase();
}
