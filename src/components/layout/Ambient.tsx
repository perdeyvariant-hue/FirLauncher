import type { CSSProperties, ReactElement } from 'react';

interface Blob {
  readonly style: CSSProperties;
  /** Colour at the centre: one of the accent trio, with its strength. */
  readonly color: string;
  /** Two waypoints of the drift, in percent of the blob's own size. */
  readonly path: readonly [number, number, number, number];
  readonly seconds: number;
}

const BLOBS: readonly Blob[] = [
  {
    style: { left: '-10%', top: '-20%', width: '70%', height: '90%' },
    color: 'rgb(var(--accent-rgb) / 0.6)',
    path: [14, 10, -8, 18],
    seconds: 22,
  },
  {
    style: { right: '-15%', top: '-10%', width: '65%', height: '85%' },
    color: 'rgb(var(--accent-2-rgb) / 0.4)',
    path: [-16, 12, 6, -10],
    seconds: 25.5,
  },
  {
    style: { left: '25%', bottom: '-35%', width: '70%', height: '90%' },
    color: 'rgb(var(--accent-3-rgb) / 0.25)',
    path: [10, -14, -12, -4],
    seconds: 29,
  },
  {
    style: { right: '-5%', bottom: '-25%', width: '45%', height: '70%' },
    color: 'rgb(var(--accent-rgb) / 0.35)',
    path: [-10, -8, 8, 12],
    seconds: 32.5,
  },
];

/**
 * What the glass has to bend: pools of the accent colours drifting slowly
 * behind everything, and a fine grain so the gradients never band. Drawn
 * under the wallpaper, which dims or replaces them.
 */
export function Ambient(): ReactElement {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0" style={{ opacity: 'var(--mesh-opacity)' }}>
        {BLOBS.map((blob) => (
          <div
            key={blob.seconds}
            className="mesh-blob"
            style={
              {
                ...blob.style,
                background: `radial-gradient(closest-side, ${blob.color}, transparent)`,
                '--mesh-x1': `${String(blob.path[0])}%`,
                '--mesh-y1': `${String(blob.path[1])}%`,
                '--mesh-x2': `${String(blob.path[2])}%`,
                '--mesh-y2': `${String(blob.path[3])}%`,
                '--mesh-duration': `${String(blob.seconds)}s`,
              } as CSSProperties
            }
          />
        ))}
      </div>
    </div>
  );
}

/** The grain on top of the wallpaper; separate so it covers pictures too. */
export function Grain(): ReactElement {
  return <div aria-hidden className="grain pointer-events-none absolute inset-0" />;
}
