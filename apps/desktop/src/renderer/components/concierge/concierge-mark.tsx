import type { ComponentProps } from 'react';

import { cn } from '@/renderer/lib/utils';

/** Side of an orbiting cell, in the mark's 24-unit canvas. */
const ORBIT_CELL_SIZE = 5;

/**
 * The three orbiting cells: the leader, then the two trailing it around the
 * ring. Opacity falls along that order so the ring reads as a sweep rather than
 * a static triangle, which is what carries the motion on a surface that is not
 * animating — but the dimmest still holds at 16px, which is the size the panel
 * header and the empty transcript draw the mark at.
 *
 * Positions sit on a radius-8.7 circle about the canvas centre, so the group
 * rotates about `50% 50%` without wobbling and its corners stay inside the
 * viewBox for the whole turn.
 */
const ORBIT_CELLS = [
	{ opacity: 1, x: 9.5, y: 0.8 },
	{ opacity: 0.8, x: 1.97, y: 13.85 },
	{ opacity: 0.55, x: 17.03, y: 13.85 },
] as const;

/**
 * Ensemblr's Concierge mark: a lead cell with three of the app icon's rounded
 * cells orbiting it — the one agent that sits above every workspace.
 *
 * Cut from the same rounded-square cell the app icon builds its `E` out of, and
 * drawn in `currentColor`, so the launcher bubble, the panel header, and the
 * empty transcript all wear one glyph at whatever weight their surface asks for.
 *
 * The orbit is its own group so a surface can spin it — pass
 * `animate-concierge-orbit` through `orbitClassName`, under whatever variant
 * should trigger it — without the mark having to learn why it is spinning.
 */
export function ConciergeMark({
	className,
	orbitClassName,
	...props
}: ComponentProps<'svg'> & {
	/** Classes for the orbiting ring alone, so a surface can animate it. */
	orbitClassName?: string;
}) {
	return (
		<svg
			aria-hidden='true'
			className={cn('size-4', className)}
			fill='currentColor'
			role='presentation'
			viewBox='0 0 24 24'
			xmlns='http://www.w3.org/2000/svg'
			{...props}
		>
			<rect height='6.6' rx='2.1' width='6.6' x='8.7' y='8.7' />
			<g className={cn('origin-center', orbitClassName)}>
				{ORBIT_CELLS.map((cell) => (
					<rect
						fillOpacity={cell.opacity}
						height={ORBIT_CELL_SIZE}
						key={`${cell.x},${cell.y}`}
						rx='1.6'
						width={ORBIT_CELL_SIZE}
						x={cell.x}
						y={cell.y}
					/>
				))}
			</g>
		</svg>
	);
}
