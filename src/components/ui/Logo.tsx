import type { ReactElement } from 'react';

export interface LogoProps {
  size?: number;
  className?: string;
}

/**
 * The fir mark. Drawn as three stacked chevrons so it stays readable at 20px
 * and needs no raster asset.
 */
export function Logo({ size = 22, className }: LogoProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 3 6.5 10h11L12 3Z" />
      <path d="M12 9.5 5 17.5h14L12 9.5Z" />
      <path d="M12 21v-3.5" />
    </svg>
  );
}
