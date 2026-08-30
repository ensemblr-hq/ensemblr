import type { ComponentProps } from 'react';

import { cn } from '@/renderer/lib/utils';

/**
 * The wordmark as ensemblr.dev draws it: a 47×7 pixel grid where every lit cell
 * is a 0.8-unit square inset by 0.1, so the letters keep their hairline gaps
 * instead of fusing into solid strokes. Merging the cells into runs would be a
 * shorter path but a different mark.
 */
const WORDMARK_PATH =
	'M0.1 0.1h.8v.8h-.8zM1.1 0.1h.8v.8h-.8zM2.1 0.1h.8v.8h-.8zM3.1 0.1h.8v.8h-.8zM4.1 0.1h.8v.8h-.8zM6.1 0.1h.8v.8h-.8zM10.1 0.1h.8v.8h-.8zM13.1 0.1h.8v.8h-.8zM14.1 0.1h.8v.8h-.8zM15.1 0.1h.8v.8h-.8zM16.1 0.1h.8v.8h-.8zM18.1 0.1h.8v.8h-.8zM19.1 0.1h.8v.8h-.8zM20.1 0.1h.8v.8h-.8zM21.1 0.1h.8v.8h-.8zM22.1 0.1h.8v.8h-.8zM24.1 0.1h.8v.8h-.8zM28.1 0.1h.8v.8h-.8zM30.1 0.1h.8v.8h-.8zM31.1 0.1h.8v.8h-.8zM32.1 0.1h.8v.8h-.8zM33.1 0.1h.8v.8h-.8zM36.1 0.1h.8v.8h-.8zM42.1 0.1h.8v.8h-.8zM43.1 0.1h.8v.8h-.8zM44.1 0.1h.8v.8h-.8zM45.1 0.1h.8v.8h-.8zM0.1 1.1h.8v.8h-.8zM6.1 1.1h.8v.8h-.8zM7.1 1.1h.8v.8h-.8zM10.1 1.1h.8v.8h-.8zM12.1 1.1h.8v.8h-.8zM18.1 1.1h.8v.8h-.8zM24.1 1.1h.8v.8h-.8zM25.1 1.1h.8v.8h-.8zM27.1 1.1h.8v.8h-.8zM28.1 1.1h.8v.8h-.8zM30.1 1.1h.8v.8h-.8zM34.1 1.1h.8v.8h-.8zM36.1 1.1h.8v.8h-.8zM42.1 1.1h.8v.8h-.8zM46.1 1.1h.8v.8h-.8zM0.1 2.1h.8v.8h-.8zM6.1 2.1h.8v.8h-.8zM8.1 2.1h.8v.8h-.8zM10.1 2.1h.8v.8h-.8zM12.1 2.1h.8v.8h-.8zM18.1 2.1h.8v.8h-.8zM24.1 2.1h.8v.8h-.8zM26.1 2.1h.8v.8h-.8zM28.1 2.1h.8v.8h-.8zM30.1 2.1h.8v.8h-.8zM34.1 2.1h.8v.8h-.8zM36.1 2.1h.8v.8h-.8zM42.1 2.1h.8v.8h-.8zM46.1 2.1h.8v.8h-.8zM0.1 3.1h.8v.8h-.8zM1.1 3.1h.8v.8h-.8zM2.1 3.1h.8v.8h-.8zM3.1 3.1h.8v.8h-.8zM6.1 3.1h.8v.8h-.8zM9.1 3.1h.8v.8h-.8zM10.1 3.1h.8v.8h-.8zM13.1 3.1h.8v.8h-.8zM14.1 3.1h.8v.8h-.8zM15.1 3.1h.8v.8h-.8zM18.1 3.1h.8v.8h-.8zM19.1 3.1h.8v.8h-.8zM20.1 3.1h.8v.8h-.8zM21.1 3.1h.8v.8h-.8zM24.1 3.1h.8v.8h-.8zM28.1 3.1h.8v.8h-.8zM30.1 3.1h.8v.8h-.8zM31.1 3.1h.8v.8h-.8zM32.1 3.1h.8v.8h-.8zM33.1 3.1h.8v.8h-.8zM36.1 3.1h.8v.8h-.8zM42.1 3.1h.8v.8h-.8zM43.1 3.1h.8v.8h-.8zM44.1 3.1h.8v.8h-.8zM45.1 3.1h.8v.8h-.8zM0.1 4.1h.8v.8h-.8zM6.1 4.1h.8v.8h-.8zM10.1 4.1h.8v.8h-.8zM16.1 4.1h.8v.8h-.8zM18.1 4.1h.8v.8h-.8zM24.1 4.1h.8v.8h-.8zM28.1 4.1h.8v.8h-.8zM30.1 4.1h.8v.8h-.8zM34.1 4.1h.8v.8h-.8zM36.1 4.1h.8v.8h-.8zM42.1 4.1h.8v.8h-.8zM44.1 4.1h.8v.8h-.8zM0.1 5.1h.8v.8h-.8zM6.1 5.1h.8v.8h-.8zM10.1 5.1h.8v.8h-.8zM16.1 5.1h.8v.8h-.8zM18.1 5.1h.8v.8h-.8zM24.1 5.1h.8v.8h-.8zM28.1 5.1h.8v.8h-.8zM30.1 5.1h.8v.8h-.8zM34.1 5.1h.8v.8h-.8zM36.1 5.1h.8v.8h-.8zM42.1 5.1h.8v.8h-.8zM45.1 5.1h.8v.8h-.8zM0.1 6.1h.8v.8h-.8zM1.1 6.1h.8v.8h-.8zM2.1 6.1h.8v.8h-.8zM3.1 6.1h.8v.8h-.8zM4.1 6.1h.8v.8h-.8zM6.1 6.1h.8v.8h-.8zM10.1 6.1h.8v.8h-.8zM12.1 6.1h.8v.8h-.8zM13.1 6.1h.8v.8h-.8zM14.1 6.1h.8v.8h-.8zM15.1 6.1h.8v.8h-.8zM18.1 6.1h.8v.8h-.8zM19.1 6.1h.8v.8h-.8zM20.1 6.1h.8v.8h-.8zM21.1 6.1h.8v.8h-.8zM22.1 6.1h.8v.8h-.8zM24.1 6.1h.8v.8h-.8zM28.1 6.1h.8v.8h-.8zM30.1 6.1h.8v.8h-.8zM31.1 6.1h.8v.8h-.8zM32.1 6.1h.8v.8h-.8zM33.1 6.1h.8v.8h-.8zM36.1 6.1h.8v.8h-.8zM37.1 6.1h.8v.8h-.8zM38.1 6.1h.8v.8h-.8zM39.1 6.1h.8v.8h-.8zM40.1 6.1h.8v.8h-.8zM42.1 6.1h.8v.8h-.8zM46.1 6.1h.8v.8h-.8z';

/**
 * The Ensemblr wordmark, inline so it costs no asset request and takes its
 * colour from `currentColor`. Sized by height alone — the width follows the
 * 47:7 grid — so callers set `h-*` and leave the rest.
 *
 * That height must be a whole multiple of 7 CSS pixels, and 14 (`h-3.5`) is the
 * smallest that reads: `shapeRendering="crispEdges"` snaps every cell to a
 * device pixel, so a height the seven grid rows do not divide drops rows out of
 * the letters rather than antialiasing them. The `wordmark` section of the
 * `nav header` playground scene renders the sizes either side of it.
 *
 * Decorative everywhere it is drawn: it labels the app inside the app's own
 * chrome, which tells a screen reader nothing its window title has not.
 */
export function EnsemblrWordmark({
	className,
	...props
}: ComponentProps<'svg'>) {
	return (
		<svg
			aria-hidden='true'
			className={cn('w-auto', className)}
			data-slot='ensemblr-wordmark'
			fill='currentColor'
			role='presentation'
			shapeRendering='crispEdges'
			viewBox='0 0 47 7'
			xmlns='http://www.w3.org/2000/svg'
			{...props}
		>
			<path d={WORDMARK_PATH} />
		</svg>
	);
}
