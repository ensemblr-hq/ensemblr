import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combines `clsx` and `twMerge` to build a single Tailwind-aware class string.
 * @param inputs - Class values to combine.
 * @returns A merged class string.
 */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
