/** Small colour helpers for deriving an accent palette from one colour. */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

interface Hsl {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

export function parseHex(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (match?.[1] === undefined) return null;
  const value = Number.parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** "139 92 246" — the channel format the design tokens use. */
export function toChannels({ r, g, b }: Rgb): string {
  return `${String(r)} ${String(g)} ${String(b)}`;
}

function toHsl({ r, g, b }: Rgb): Hsl {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === red
      ? (green - blue) / d + (green < blue ? 6 : 0)
      : max === green
        ? (blue - red) / d + 2
        : (red - green) / d + 4;
  return { h: h / 6, s, l };
}

function fromHsl({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    const grey = Math.round(l * 255);
    return { r: grey, g: grey, b: grey };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t0: number): number => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    const value =
      t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    return Math.round(value * 255);
  };
  return { r: channel(h + 1 / 3), g: channel(h), b: channel(h - 1 / 3) };
}

/** Moves lightness by `amount` (−1…1), clamped. */
export function shiftLightness(color: Rgb, amount: number): Rgb {
  const hsl = toHsl(color);
  return fromHsl({ ...hsl, l: Math.min(0.95, Math.max(0.05, hsl.l + amount)) });
}

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function luminance({ r, g, b }: Rgb): number {
  const linear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export interface AccentPalette {
  readonly accent: Rgb;
  readonly hover: Rgb;
  readonly dim: Rgb;
  /** Text drawn on the accent: whichever of near-white/near-black reads better. */
  readonly onAccent: Rgb;
}

const LIGHT_TEXT: Rgb = { r: 255, g: 255, b: 255 };
const DARK_TEXT: Rgb = { r: 24, g: 24, b: 27 };

/**
 * The dark theme keeps the chosen colour and lightens it on hover; the light
 * theme darkens it a touch (a pale accent vanishes on white) and darkens
 * further on hover — the same rhythm as the stock purple in tokens.css.
 */
export function accentPalette(base: Rgb, theme: 'dark' | 'light'): AccentPalette {
  const accent = theme === 'dark' ? base : shiftLightness(base, -0.06);
  const hover = theme === 'dark' ? shiftLightness(base, 0.1) : shiftLightness(base, -0.14);
  const dim = theme === 'dark' ? shiftLightness(base, -0.14) : shiftLightness(base, 0.18);
  // White reads as "button" on saturated colours even where dark text would
  // measure slightly higher; only genuinely pale accents (yellow, mint,
  // light grey) switch to dark text.
  const onAccent = luminance(accent) > PALE_LUMINANCE ? DARK_TEXT : LIGHT_TEXT;
  return { accent, hover, dim, onAccent };
}

const PALE_LUMINANCE = 0.36;

/** Contrast ratio of two colours, 1…21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
