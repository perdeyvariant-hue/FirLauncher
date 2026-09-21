import type { ReactElement } from 'react';
import { cn } from '@/lib/cn';
import { initialsOf } from '@/lib/format';

export interface AvatarProps {
  name: string;
  /**
   * The player's head, rendered by the backend from the skin (it applies the
   * game's legacy-transparency rule, which a CSS crop cannot). Null falls back
   * to deterministic initials.
   */
  src: string | null;
  size?: number;
  className?: string;
}

/** Deterministic hue so two accounts never look alike without a skin. */
function hueOf(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 360;
  }
  return hash;
}

export function Avatar({ name, src, size = 32, className }: AvatarProps): ReactElement {
  if (src !== null) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className={cn('shrink-0 rounded-md', className)}
        // An 8x8 head scaled up must stay crisp, not blurred.
        style={{ imageRendering: 'pixelated' }}
      />
    );
  }

  const hue = hueOf(name);
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 select-none items-center justify-center rounded-md font-medium',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        background: `hsl(${String(hue)} 18% 22%)`,
        color: `hsl(${String(hue)} 45% 78%)`,
      }}
    >
      {initialsOf(name)}
    </span>
  );
}
