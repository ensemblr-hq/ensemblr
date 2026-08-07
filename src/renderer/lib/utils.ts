import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Custom `--text-*` scales from `styles/index.css`. tailwind-merge only reads
 * Tailwind's own scale, and anything it does not recognise as a size falls into
 * the text-*colour* group — so `cn('text-xxs', 'text-status-warning')` dropped
 * the size and left the label rendering at whatever it inherited. Registering
 * the scales puts them back in the font-size group.
 */
const CUSTOM_TEXT_SCALES = ['xxs', 'code-body'];

const twMerge = extendTailwindMerge({
	extend: { theme: { text: CUSTOM_TEXT_SCALES } },
});

/**
 * Combines `clsx` and `twMerge` to build a single Tailwind-aware class string.
 * @param inputs - Class values to combine.
 * @returns A merged class string.
 */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
