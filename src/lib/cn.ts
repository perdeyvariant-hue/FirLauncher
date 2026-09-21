import clsx from 'clsx';
import type { ClassValue } from 'clsx';

/**
 * Thin alias over clsx. We deliberately skip tailwind-merge: components own
 * their base classes and expose explicit variants instead of fighting over
 * conflicting utilities.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
