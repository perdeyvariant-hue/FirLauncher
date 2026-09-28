import type { ReactElement } from 'react';
import { cn } from '@/lib/cn';
import { initialsOf } from '@/lib/format';
import { artGradient, artIndexOf } from '@/lib/art';

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

export function Avatar({ name, src, size = 32, className }: AvatarProps): ReactElement {
  const radius = Math.round(size * 0.27);
  if (src !== null) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className={cn('shrink-0', className)}
        // An 8x8 head scaled up must stay crisp, not blurred.
        style={{ imageRendering: 'pixelated', borderRadius: radius }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 select-none items-center justify-center font-mono font-bold text-white',
        'shadow-[inset_0_-4px_0_rgb(0_0_0/0.18),inset_0_1px_0_rgb(255_255_255/0.35)]',
        className,
      )}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: Math.round(size * 0.32),
        background: artGradient(artIndexOf(name)),
      }}
    >
      {initialsOf(name)}
    </span>
  );
}
