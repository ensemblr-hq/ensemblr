import type { ComponentProps } from 'react';

import { ConciergeMark } from '@/renderer/components/concierge/concierge-mark';
import { cn } from '@/renderer/lib/utils';

/** The mark's square canvas, matching the shipped `ConciergeMark` viewBox. */
const CANVAS = 24;

/**
 * How much of its grid cell one lit pixel fills, and how far its corners round.
 *
 * Both ratios come from `scripts/icon-art.mjs` — `PIXEL_INSET = CELL * 0.12`
 * (so the pixel fills `1 - 0.12 * 2` of its cell) and `PIXEL_RADIUS =
 * PIXEL_SIZE * 0.16` — so every variant here is cut from the same pixel the app
 * icon builds its `E` out of. The shipped mark rounds at 0.32, twice this, which
 * is most of why it reads as a generic squircle rather than a dot-matrix cell.
 */
const CELL_FILL_RATIO = 0.76;
const CELL_RADIUS_RATIO = 0.16;

/**
 * The chromatic-split channels, matching the `GhostLayer` pair in
 * `src/renderer/components/welcome/welcome-wordmark.tsx` and the
 * `COLOR_GHOST_*` constants in `scripts/icon-colors.mjs`.
 */
const GHOST_CYAN = '#22d3ee';
const GHOST_RED = '#ff2e63';

/**
 * How far the Ghost variant's two channels sit either side of the core.
 *
 * Wide enough that the fringe survives 16px, where a smaller split collapses to
 * a sub-pixel smear — the icon's own `CELL * 0.27` is tuned for a 1024px canvas
 * and reads as a blur down here. Bounded above by `GHOST_QUAD`'s 7.44 gap: the
 * resting `2 * GHOST_OFFSET` split takes 4.2 of it, leaving 3.24, of which
 * `GHOST_SPLIT_SWING` spends a further 2.4 at its peak and leaves 0.84.
 */
const GHOST_OFFSET = 2.1;

/**
 * How much further apart the working animation pushes the two channels at its
 * peak, on top of the resting `GHOST_OFFSET`.
 *
 * Bounded by the same gap `GHOST_QUAD` is spaced for: at 1.2 the peak split is
 * 6.6 against a 7.44 gap, so 0.84 units stay clear and the mark never fuses into
 * a bar mid-cycle. It also decides how far the outermost channel reaches — 3.3
 * puts the peak extent at 0.42..23.58, inside the 24-unit canvas.
 */
const GHOST_SPLIT_SWING = 1.2;

/**
 * The pulse a cell runs while the mark is working, named for the resting
 * opacity its keyframe returns to — a cell's `opacity` and its pulse must agree
 * or the animation will jump on its first frame.
 */
type MarkPulse = 'half' | 'low';

/** One lit cell of a mark, positioned by its centre on the 24-unit canvas. */
interface MarkCell {
	cx: number;
	cy: number;
	size: number;
	opacity?: number;
	pulse?: MarkPulse;
	/** Seconds this cell lags the cycle, so a group reads as a sweep. */
	pulseDelay?: number;
}

/** What every variant accepts, so the scene can drive them from one loop. */
export interface MarkProps {
	className?: string;
	isWorking?: boolean;
}

/**
 * Places one cell on a `grid × grid` lattice over the canvas, sized by the app
 * icon's own fill ratio. Fractional `col`/`row` are deliberate — several
 * variants want a cell between lattice points without changing the pixel size
 * the grid implies.
 * @param grid - Cells per side of the lattice.
 * @param col - Column index, where 0 is the leftmost cell.
 * @param row - Row index, where 0 is the topmost cell.
 * @param cell - The cell's own fields, plus a `scale` multiplying the pixel size.
 * @returns The positioned cell.
 */
function gridCell(
	grid: number,
	col: number,
	row: number,
	{
		scale = 1,
		...rest
	}: Omit<MarkCell, 'cx' | 'cy' | 'size'> & { scale?: number } = {},
): MarkCell {
	const cell = CANVAS / grid;
	return {
		cx: (col + 0.5) * cell,
		cy: (row + 0.5) * cell,
		size: cell * CELL_FILL_RATIO * scale,
		...rest,
	};
}

/**
 * Keyframes for the candidates' working states, scoped to the playground so a
 * variant can be judged in motion before anything is added to
 * `src/renderer/styles/index.css`. Whichever variant ships moves its keyframe
 * into that file's `@theme inline` block beside `--animate-concierge-orbit`.
 *
 * `transform-box` is left at its `view-box` default on the spin so the ring
 * turns about the canvas centre rather than its own bounding box, which sits
 * above centre and would wobble. The split animates a CSS `transform` over the
 * `transform` attribute that holds the resting offset, so reduced motion keeps
 * the ghosts parted rather than collapsing them onto the core.
 */
const KEYFRAMES = `
@keyframes concierge-variant-spin {
  to { transform: rotate(1turn); }
}
@keyframes concierge-variant-pulse-half {
  0%, 100% { fill-opacity: 0.5; }
  45% { fill-opacity: 1; }
}
@keyframes concierge-variant-pulse-low {
  0%, 100% { fill-opacity: 0.35; }
  45% { fill-opacity: 1; }
}
@keyframes concierge-variant-split-back {
  0%, 100% { transform: translateX(-${GHOST_OFFSET}px); }
  50% { transform: translateX(-${GHOST_OFFSET + GHOST_SPLIT_SWING}px); }
}
@keyframes concierge-variant-split-fore {
  0%, 100% { transform: translateX(${GHOST_OFFSET}px); }
  50% { transform: translateX(${GHOST_OFFSET + GHOST_SPLIT_SWING}px); }
}
@media (prefers-reduced-motion: no-preference) {
  .concierge-variant-spin {
    animation: concierge-variant-spin 5s linear infinite;
    transform-origin: 50% 50%;
  }
  .concierge-variant-pulse-half {
    animation: concierge-variant-pulse-half 1.5s ease-in-out infinite;
  }
  .concierge-variant-pulse-low {
    animation: concierge-variant-pulse-low 1.9s ease-in-out infinite;
  }
  .concierge-variant-split-back {
    animation: concierge-variant-split-back 1.6s ease-in-out infinite;
  }
  .concierge-variant-split-fore {
    animation: concierge-variant-split-fore 1.6s ease-in-out infinite;
  }
}
`;

/**
 * Publishes the candidates' keyframes. Rendered once by the scene rather than
 * by each mark, since a page showing forty marks would otherwise carry forty
 * copies of the same stylesheet.
 */
export function ConciergeMarkKeyframes() {
	return <style>{KEYFRAMES}</style>;
}

/**
 * The SVG shell every candidate shares, so the only thing that differs between
 * them is the cells they lay down.
 */
function MarkCanvas({ className, ...props }: ComponentProps<'svg'>) {
	return (
		<svg
			aria-hidden='true'
			className={cn('size-4', className)}
			fill='currentColor'
			role='presentation'
			viewBox={`0 0 ${CANVAS} ${CANVAS}`}
			xmlns='http://www.w3.org/2000/svg'
			{...props}
		/>
	);
}

/**
 * Draws a set of cells as rounded rects, attaching each one's pulse only while
 * the mark is working.
 *
 * A cell without its own `opacity` emits no `fill-opacity` at all rather than an
 * explicit `1`. `fill-opacity` is inherited rather than compounded, so writing
 * the attribute on the rect would replace — not multiply with — the value an
 * enclosing group sets, which is how Ghost's two channels take their 0.55/0.38.
 */
function MarkCells({
	cells,
	isWorking,
}: {
	cells: readonly MarkCell[];
	isWorking: boolean;
}) {
	return cells.map((cell) => (
		<rect
			className={
				isWorking && cell.pulse
					? `concierge-variant-pulse-${cell.pulse}`
					: undefined
			}
			fillOpacity={cell.opacity}
			height={cell.size}
			key={`${cell.cx},${cell.cy}`}
			rx={cell.size * CELL_RADIUS_RATIO}
			style={
				isWorking && cell.pulseDelay
					? { animationDelay: `${cell.pulseDelay}s` }
					: undefined
			}
			width={cell.size}
			x={cell.cx - cell.size / 2}
			y={cell.cy - cell.size / 2}
		/>
	));
}

/**
 * The shipped mark, adapted to the candidates' prop shape so the scene can put
 * it in the same row as everything it is being compared against.
 */
export function ConciergeMarkCurrent({
	className,
	isWorking = false,
}: MarkProps) {
	return (
		<ConciergeMark
			className={className}
			orbitClassName={
				isWorking ? 'motion-safe:animate-concierge-orbit' : undefined
			}
		/>
	);
}

/** Hub's lead cell and the four it presides over, on a 5-cell lattice. */
const HUB_CORE = gridCell(5, 2, 2, { scale: 1.5 });
const HUB_CORNERS: readonly MarkCell[] = [
	gridCell(5, 0.55, 0.55, { opacity: 0.5, pulse: 'half', scale: 1.1 }),
	gridCell(5, 3.45, 0.55, {
		opacity: 0.5,
		pulse: 'half',
		pulseDelay: 0.2,
		scale: 1.1,
	}),
	gridCell(5, 3.45, 3.45, {
		opacity: 0.5,
		pulse: 'half',
		pulseDelay: 0.4,
		scale: 1.1,
	}),
	gridCell(5, 0.55, 3.45, {
		opacity: 0.5,
		pulse: 'half',
		pulseDelay: 0.6,
		scale: 1.1,
	}),
];

/**
 * Hub: a lead cell with four reporting into it from the corners. Four-fold
 * symmetry is the point — it is what stops the mark reading as a spinner, since
 * a rotation of it is indistinguishable from a rest. Working sweeps the corners
 * clockwise instead of turning anything.
 */
export function ConciergeMarkHub({ className, isWorking = false }: MarkProps) {
	return (
		<MarkCanvas className={className}>
			<MarkCells cells={[HUB_CORE]} isWorking={isWorking} />
			<MarkCells cells={HUB_CORNERS} isWorking={isWorking} />
		</MarkCanvas>
	);
}

/** Rank's lead cell and the row of three beneath it. */
const RANK_LEAD = gridCell(5, 2, 1, { scale: 1.45 });
const RANK_ROW: readonly MarkCell[] = [
	gridCell(5, 0.8, 3, { opacity: 0.5, pulse: 'half', scale: 1.1 }),
	gridCell(5, 2, 3, {
		opacity: 0.5,
		pulse: 'half',
		pulseDelay: 0.16,
		scale: 1.1,
	}),
	gridCell(5, 3.2, 3, {
		opacity: 0.5,
		pulse: 'half',
		pulseDelay: 0.32,
		scale: 1.1,
	}),
];

/**
 * Rank: one cell above a row of three — the one agent that sits above every
 * workspace, drawn literally. The silhouette is unlike anything else in the
 * app's icon set, and with only four cells it survives 16px better than any
 * other candidate here. Working lights the row left to right, which reads as
 * dispatch rather than as loading.
 */
export function ConciergeMarkRank({ className, isWorking = false }: MarkProps) {
	return (
		<MarkCanvas className={className}>
			<MarkCells cells={[RANK_LEAD]} isWorking={isWorking} />
			<MarkCells cells={RANK_ROW} isWorking={isWorking} />
		</MarkCanvas>
	);
}

/**
 * Ghost's core quad: the smallest cluster that still reads as pixels.
 *
 * Held off the lattice points, because the gap between the four has to stay
 * wider than the split that passes through it at its widest: once the two offset
 * channels meet in the middle, the whole mark fuses into a solid bar. At
 * 0.5/2.5 the centres are 6 and 18, so the gap is `18 - 6 - 4.56 = 7.44` — clear
 * of the 4.2 resting split by 3.24, and of the 6.6 the working animation peaks
 * at by 0.84. Horizontally that leaves less air than the untouched 7.44 vertical
 * gap, which is what a horizontal chromatic smear should look like.
 */
const GHOST_QUAD: readonly MarkCell[] = [
	gridCell(4, 0.5, 0.5),
	gridCell(4, 2.5, 0.5),
	gridCell(4, 0.5, 2.5),
	gridCell(4, 2.5, 2.5),
];

/**
 * Ghost: a 2×2 pixel core with the icon's own chromatic split behind it. This
 * is the candidate that carries the most identity per pixel — the cyan/red
 * offset is the single most recognisable thing about the Ensemblr icon and the
 * wordmark, and nothing else in the app reuses it.
 *
 * `chromatic` swaps the two ghost channels from `currentColor` to the icon's
 * literal hues. Both are worth judging: the tinted cut is unmistakable but stops
 * being a one-colour glyph, so it cannot take the launcher's accent fill or the
 * header's muted grey the way the rest of these can.
 */
export function ConciergeMarkGhost({
	chromatic = false,
	className,
	isWorking = false,
}: MarkProps & { chromatic?: boolean }) {
	return (
		<MarkCanvas className={className}>
			<g
				className={isWorking ? 'concierge-variant-split-back' : undefined}
				fill={chromatic ? GHOST_CYAN : undefined}
				fillOpacity={chromatic ? 0.55 : 0.38}
				transform={`translate(${-GHOST_OFFSET} 0)`}
			>
				<MarkCells cells={GHOST_QUAD} isWorking={false} />
			</g>
			<g
				className={isWorking ? 'concierge-variant-split-fore' : undefined}
				fill={chromatic ? GHOST_RED : undefined}
				fillOpacity={chromatic ? 0.55 : 0.38}
				transform={`translate(${GHOST_OFFSET} 0)`}
			>
				<MarkCells cells={GHOST_QUAD} isWorking={false} />
			</g>
			<MarkCells cells={GHOST_QUAD} isWorking={false} />
		</MarkCanvas>
	);
}

/**
 * Ghost in one colour, which is the cut `CONCIERGE_MARK_VARIANTS` in
 * `concierge-catalog.tsx` compares against the others. The tinted cut is shown
 * beside it in its own row rather than entered as a seventh candidate, since the
 * two are one design at two settings.
 */
export function ConciergeMarkGhostMono({
	className,
	isWorking = false,
}: MarkProps) {
	return <ConciergeMarkGhost className={className} isWorking={isWorking} />;
}

/**
 * Ghost in the icon's own two channels, so the tinted cut can be handed to
 * anything that takes a plain mark — the launcher bubble included, which is
 * where the cost of dropping `currentColor` actually shows.
 */
export function ConciergeMarkGhostChromatic({
	className,
	isWorking = false,
}: MarkProps) {
	return (
		<ConciergeMarkGhost chromatic className={className} isWorking={isWorking} />
	);
}

/** Sigil's spine — the `E`'s vertical stroke, holding the arms up. */
const SIGIL_SPINE: readonly MarkCell[] = [0, 1, 2, 3, 4].map((row) =>
	gridCell(5, 1, row, { scale: 1.05 }),
);

/** Sigil's three arms, lighting top to bottom while the mark works. */
const SIGIL_ARMS: readonly MarkCell[] = [0, 2, 4].flatMap((row, rowIndex) =>
	[2, 3].map((col, colIndex) =>
		gridCell(5, col, row, {
			opacity: 0.5,
			pulse: 'half',
			pulseDelay: rowIndex * 0.14 + colIndex * 0.07,
			scale: 1.05,
		}),
	),
);

/**
 * Sigil: the dot-matrix `E` at 3×5, with its spine lit and its arms held back.
 * The closest tie to the app icon of anything here, and the reason to be wary of
 * it — the `E` is the *product's* mark, so a feature wearing it competes with
 * the icon rather than sitting under it. Eleven cells is also the densest of
 * these candidates, which is what makes 16px the size to judge it at.
 */
export function ConciergeMarkSigil({
	className,
	isWorking = false,
}: MarkProps) {
	return (
		<MarkCanvas className={className}>
			<MarkCells cells={SIGIL_SPINE} isWorking={isWorking} />
			<MarkCells cells={SIGIL_ARMS} isWorking={isWorking} />
		</MarkCanvas>
	);
}

/** Orbit's core, sized to the shipped mark's 6.6-unit centre cell. */
const ORBIT_CORE = gridCell(4, 1.5, 1.5, { scale: 1.45 });

/**
 * Orbit's satellites, on the shipped mark's radius-8.7 ring.
 *
 * The opacity falls in the shipped mark's own order — leader, then the
 * bottom-left cell, then the bottom-right — so the trail runs the same way round
 * the ring as `ORBIT_CELLS` in `src/renderer/components/concierge/concierge-mark.tsx`.
 * Reversing it would put a second change beside the corner radius this variant
 * exists to isolate.
 */
const ORBIT_RING: readonly MarkCell[] = [
	{ cx: 12, cy: 3.3, opacity: 1, size: 5.016 },
	{ cx: 4.466, cy: 16.35, opacity: 0.8, size: 5.016 },
	{ cx: 19.534, cy: 16.35, opacity: 0.6, size: 5.016 },
];

/**
 * Orbit: the shipped composition, re-cut at the icon's 0.16 corner radius
 * instead of 0.32. The conservative option — it keeps whatever recognition the
 * current bubble has earned and only fixes the rounding mismatch, so it is the
 * one to pick if the composition was never the problem.
 */
export function ConciergeMarkOrbit({
	className,
	isWorking = false,
}: MarkProps) {
	return (
		<MarkCanvas className={className}>
			<MarkCells cells={[ORBIT_CORE]} isWorking={isWorking} />
			<g className={isWorking ? 'concierge-variant-spin' : undefined}>
				<MarkCells cells={ORBIT_RING} isWorking={false} />
			</g>
		</MarkCanvas>
	);
}

/** Console's lead cell, sitting proud of the field it leads. */
const CONSOLE_LEAD = gridCell(3, 1, 0, { scale: 1.2 });

/** Console's field: the eight cells the lead one is not. */
const CONSOLE_FIELD: readonly MarkCell[] = [0, 1, 2].flatMap((row) =>
	[0, 1, 2]
		.filter((col) => !(col === 1 && row === 0))
		.map((col) =>
			gridCell(3, col, row, {
				opacity: 0.35,
				pulse: 'low',
				pulseDelay: (col + row) * 0.12,
				scale: 0.85,
			}),
		),
);

/**
 * Console: a 3×3 field with one cell lit and enlarged at its head — every
 * workspace, and the one agent above them. The most systemic of the six and the
 * only one that fills its box, so it holds weight on the launcher bubble that
 * the airier candidates do not. Working runs a wave across the field on the
 * diagonal.
 */
export function ConciergeMarkConsole({
	className,
	isWorking = false,
}: MarkProps) {
	return (
		<MarkCanvas className={className}>
			<MarkCells cells={[CONSOLE_LEAD]} isWorking={isWorking} />
			<MarkCells cells={CONSOLE_FIELD} isWorking={isWorking} />
		</MarkCanvas>
	);
}
