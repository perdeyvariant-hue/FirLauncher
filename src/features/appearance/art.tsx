import type { ReactElement } from 'react';

/**
 * FirLauncher's own built-in wallpapers, drawn here in SVG/CSS (no
 * third-party assets) and coloured from the design tokens, so they follow the
 * accent colour and the theme.
 */

const ACCENT = 'rgb(var(--accent-rgb))';

/** Soft accent-coloured glows. */
export function MistWallpaper(): ReactElement {
  return (
    <div
      className="absolute inset-0"
      style={{
        background: [
          'radial-gradient(55% 45% at 15% 5%, rgb(var(--accent-rgb) / 0.20), transparent 70%)',
          'radial-gradient(45% 40% at 95% 85%, rgb(var(--accent-rgb) / 0.14), transparent 70%)',
          'radial-gradient(35% 30% at 70% 30%, rgb(var(--accent-hover-rgb) / 0.08), transparent 70%)',
        ].join(', '),
      }}
    />
  );
}

/** A quiet dot grid with an accent glow in one corner. */
export function DotsWallpaper(): ReactElement {
  return (
    <>
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(rgb(var(--text-dim-rgb) / 0.22) 1px, transparent 1.4px)',
          backgroundSize: '22px 22px',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(60% 55% at 100% 100%, rgb(var(--accent-rgb) / 0.12), transparent 70%)',
        }}
      />
    </>
  );
}

/** Deterministic "random" so the forest looks the same on every start. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Outline of one fir, top at (x, base − h). */
function firPath(x: number, base: number, h: number): string {
  const pts: [number, number][] = [
    [0, 0], [0.17, 0.3], [0.09, 0.3], [0.27, 0.6], [0.15, 0.6], [0.36, 0.92], [0.05, 0.92],
    [0.05, 1], [-0.05, 1], [-0.05, 0.92], [-0.36, 0.92], [-0.15, 0.6], [-0.27, 0.6],
    [-0.09, 0.3], [-0.17, 0.3],
  ];
  return `M${pts.map(([dx, dy]) => `${(x + dx * h).toFixed(1)},${(base - h + dy * h).toFixed(1)}`).join('L')}Z`;
}

function forestLayer(seed: number, base: number, minH: number, maxH: number, gap: number): string {
  const random = seeded(seed);
  const trees: string[] = [];
  for (let x = -40; x < 1640; x += gap * (0.6 + random() * 0.8)) {
    trees.push(firPath(x, base, minH + random() * (maxH - minH)));
  }
  // Ground under the trunks so layers read as solid hills.
  trees.push(`M-40,${String(base - 4)}H1640V520H-40Z`);
  return trees.join('');
}

const FOREST = [
  { d: forestLayer(7, 360, 70, 130, 38), opacity: 0.1 },
  { d: forestLayer(21, 430, 90, 170, 52), opacity: 0.16 },
  { d: forestLayer(42, 505, 120, 220, 70), opacity: 0.26 },
];

/** Layered fir silhouettes under a glowing sky. */
export function ForestWallpaper(): ReactElement {
  return (
    <>
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(40% 35% at 78% 18%, rgb(var(--accent-hover-rgb) / 0.16), transparent 70%)',
        }}
      />
      <svg
        viewBox="0 0 1600 500"
        preserveAspectRatio="xMidYMax slice"
        className="absolute inset-x-0 bottom-0 h-[55%] w-full"
        aria-hidden
      >
        {FOREST.map((layer) => (
          <path key={layer.opacity} d={layer.d} fill={ACCENT} opacity={layer.opacity} />
        ))}
      </svg>
    </>
  );
}
