/**
 * The gradients behind an instance's or account's initials when there is no
 * picture. A user picks one when creating an instance; otherwise the id
 * decides, so the same thing always wears the same colours.
 */
export const ART_GRADIENTS: readonly (readonly [string, string])[] = [
  ['#a855f7', '#6366f1'],
  ['#22c55e', '#0ea5e9'],
  ['#f97316', '#ef4444'],
  ['#ec4899', '#a855f7'],
  ['#0ea5e9', '#6366f1'],
  ['#eab308', '#f97316'],
  ['#64748b', '#334155'],
];

/** A stable colour index for any string. */
export function artIndexOf(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash % ART_GRADIENTS.length;
}

export function artGradient(index: number): string {
  const pair = ART_GRADIENTS[((index % ART_GRADIENTS.length) + ART_GRADIENTS.length) % ART_GRADIENTS.length];
  const [from, to] = pair ?? ['#a855f7', '#6366f1'];
  return `linear-gradient(135deg, ${from}, ${to})`;
}
