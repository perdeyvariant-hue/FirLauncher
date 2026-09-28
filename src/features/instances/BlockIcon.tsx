import type { ReactElement } from 'react';
import type { BlockDef } from '@/lib/blocks';

interface Face {
  readonly texture: string;
  readonly transform: string;
  /** Darkening, the way the game shades a block's sides in the inventory. */
  readonly shade: number;
  readonly tint?: string;
}

/**
 * A block drawn the way the inventory draws it: an isometric cube with its
 * own textures, the top lit, the sides a step darker each. Faces turned
 * away are culled, so which sides are listed does not matter.
 */
export function BlockIcon({
  block,
  textures,
  size,
  className,
}: {
  block: BlockDef;
  textures: Record<string, string>;
  /** Width of the drawn cube, px. */
  size: number;
  className?: string;
}): ReactElement | null {
  const top = textures[block.top];
  const side = textures[block.side];
  if (top === undefined || side === undefined) return null;
  const front = block.front === undefined ? side : (textures[block.front] ?? side);

  // An isometric cube is about 1.7 times as wide as its edge.
  const edge = Math.round(size / 1.72);
  const half = edge / 2;
  const faces: readonly Face[] = [
    { texture: top, transform: `rotateX(90deg) translateZ(${String(half)}px)`, shade: 0, tint: block.topTint },
    { texture: front, transform: `translateZ(${String(half)}px)`, shade: 0.2 },
    { texture: side, transform: `rotateY(90deg) translateZ(${String(half)}px)`, shade: 0.38 },
    { texture: side, transform: `rotateY(-90deg) translateZ(${String(half)}px)`, shade: 0.38 },
    { texture: side, transform: `rotateY(180deg) translateZ(${String(half)}px)`, shade: 0.2 },
  ];

  return (
    <div
      aria-hidden
      className={className}
      style={{ width: size, height: size, display: 'grid', placeItems: 'center' }}
    >
      <div
        style={{
          position: 'relative',
          width: edge,
          height: edge,
          transformStyle: 'preserve-3d',
          transform: 'rotateX(-30deg) rotateY(-45deg)',
        }}
      >
        {faces.map((face) => (
          <div
            key={face.transform}
            style={
              {
                position: 'absolute',
                inset: 0,
                backfaceVisibility: 'hidden',
                transform: face.transform,
                // Animated textures are strips of frames; the first one shows.
                backgroundImage: `linear-gradient(rgb(0 0 0 / ${String(face.shade)}), rgb(0 0 0 / ${String(face.shade)})), url(${face.texture})`,
                backgroundSize: '100% 100%, 100% auto',
                backgroundPosition: 'top',
                backgroundRepeat: 'no-repeat',
                backgroundColor: face.tint,
                backgroundBlendMode: face.tint === undefined ? 'normal' : 'normal, multiply',
                imageRendering: 'pixelated',
              }
            }
          />
        ))}
      </div>
    </div>
  );
}
