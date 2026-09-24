import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combines conditional class values and resolves conflicting Tailwind utilities.
 * @param inputs - Class values to combine.
 * @returns A merged class string.
 */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
