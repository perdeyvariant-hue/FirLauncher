/**
 * The gradients behind an instance's or account's initials when there is no
 * picture. A user picks one when creating an instance; otherwise the id
 * decides, so the same thing always wears the same colours.
 */
// One hue each, light to dark: a ground for the picture, not a picture itself.
export const ART_GRADIENTS: readonly (readonly [string, string])[] = [
  ['#8b5cf6', '#5b21b6'],
  ['#22c55e', '#166534'],
  ['#f97316', '#9a3412'],
  ['#ec4899', '#9d174d'],
  ['#0ea5e9', '#075985'],
  ['#eab308', '#854d0e'],
  ['#64748b', '#1e293b'],
];

/** A stable number for any string. */
export function hashOf(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash;
}

/** A stable colour index for any string. */
export function artIndexOf(key: string): number {
  return hashOf(key) % ART_GRADIENTS.length;
}

export function artGradient(index: number): string {
  const pair = ART_GRADIENTS[((index % ART_GRADIENTS.length) + ART_GRADIENTS.length) % ART_GRADIENTS.length];
  const [from, to] = pair ?? ['#a855f7', '#6366f1'];
  return `linear-gradient(135deg, ${from}, ${to})`;
}
