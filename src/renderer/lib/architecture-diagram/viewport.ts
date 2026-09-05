/**
 * Pan and zoom arithmetic for the diagram canvas.
 *
 * Kept out of the hook that holds the state so the awkward parts — keeping the
 * point under the cursor fixed across a zoom, framing a canvas inside a pane —
 * are plain functions with no DOM in them, and can be tested under Vitest's
 * `node` environment like the rest of the compiler.
 */
import type { DiagramSize } from '@/shared/architecture-diagram';

/**
 * How far the canvas may be scaled, and the step the toolbar buttons take.
 *
 * The floor is low enough for fit-to-view to actually frame a scanned diagram:
 * the seeded document for this repository compiles to ~2,800px of height, which
 * a panel-height pane can only show whole well under a third of actual size.
 */
export const ZOOM = { max: 2.5, min: 0.1, step: 0.2 } as const;

/** Room left around the drawing when it is framed to the pane. */
const FIT_PADDING = 24;

/**
 * Scroll distance that corresponds to one e-fold of zoom, per gesture.
 *
 * A trackpad pinch reaches the renderer as a `wheel` event carrying `ctrlKey`,
 * with deltas an order of magnitude smaller than a wheel notch's, so the two
 * cannot share a divisor: tuned for the wheel a pinch barely moves, and tuned
 * for the pinch a single notch jumps the whole zoom range.
 */
const ZOOM_DIVISOR = { pinch: 60, wheel: 320 } as const;

/** Where the drawing sits in the pane: a translation in CSS pixels, then a scale. */
export interface DiagramViewport {
	x: number;
	y: number;
	zoom: number;
}

/** The untouched view: origin, actual size. */
export const IDENTITY_VIEWPORT: DiagramViewport = { x: 0, y: 0, zoom: 1 };

/**
 * Holds a zoom level inside the bounds the toolbar advertises.
 * @param zoom - The requested scale
 * @returns The scale actually applied
 */
export function clampZoom(zoom: number): number {
	return Math.min(ZOOM.max, Math.max(ZOOM.min, zoom));
}

/**
 * Rescales the view about a fixed point, so the part of the drawing under the
 * cursor stays under the cursor. Without this a zoom walks the diagram out of
 * the pane and the user has to chase it.
 * @param view - The current viewport
 * @param zoom - The requested scale
 * @param focus - Point to hold still, in pane-relative CSS pixels
 * @returns The rescaled viewport
 */
export function zoomAbout(
	view: DiagramViewport,
	zoom: number,
	focus: { x: number; y: number },
): DiagramViewport {
	const next = clampZoom(zoom);
	const ratio = next / view.zoom;
	return {
		x: focus.x - (focus.x - view.x) * ratio,
		y: focus.y - (focus.y - view.y) * ratio,
		zoom: next,
	};
}

/**
 * The scale a wheel or pinch gesture asks for, exponential so each notch feels
 * the same whatever the current zoom.
 * @param zoom - The current scale
 * @param deltaY - Wheel delta, in the event's own units
 * @param gesture - Which gesture produced the delta
 * @returns The requested scale, before clamping
 */
export function wheelZoom(
	zoom: number,
	deltaY: number,
	gesture: 'pinch' | 'wheel',
): number {
	return zoom * Math.exp(-deltaY / ZOOM_DIVISOR[gesture]);
}

/**
 * Frames a whole drawing inside a pane, centred, never magnified past 1:1 — a
 * six-node diagram blown up to fill the pane reads as broken rather than
 * generous.
 * @param viewBox - The compiled canvas size
 * @param pane - The pane's measured size in CSS pixels
 * @returns The viewport that frames it, or the identity when the pane is unmeasured
 */
export function fitViewport(
	viewBox: DiagramSize,
	pane: { height: number; width: number },
): DiagramViewport {
	const [width, height] = viewBox;
	if (pane.width <= 0 || pane.height <= 0 || width <= 0 || height <= 0) {
		return IDENTITY_VIEWPORT;
	}
	const zoom = clampZoom(
		Math.min(
			1,
			(pane.width - FIT_PADDING * 2) / width,
			(pane.height - FIT_PADDING * 2) / height,
		),
	);
	return {
		x: (pane.width - width * zoom) / 2,
		y: (pane.height - height * zoom) / 2,
		zoom,
	};
}

/**
 * Moves the view by a pointer or keyboard delta.
 * @param view - The current viewport
 * @param dx - Horizontal movement in CSS pixels
 * @param dy - Vertical movement in CSS pixels
 * @returns The panned viewport
 */
export function panViewport(
	view: DiagramViewport,
	dx: number,
	dy: number,
): DiagramViewport {
	return { ...view, x: view.x + dx, y: view.y + dy };
}
