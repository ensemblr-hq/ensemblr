/**
 * The geometry a compiled diagram hands the SVG surface.
 *
 * Held apart from `compile.ts` because both layout modes produce it: the grid
 * compiler builds these directly, and the organic solver builds the frames and
 * positions that the compiler assembles into them. A shared home is what keeps
 * the two from importing each other.
 */
import type {
	ArchitectureBoundary,
	ArchitectureComponent,
	ArchitectureConnection,
	DiagramPoint,
	DiagramSize,
} from '@/shared/architecture-diagram';

import type { MeasuredRect } from './routing';

/** A positioned node, ready to draw. */
export interface DiagramNode extends MeasuredRect {
	component: ArchitectureComponent;
}

/** A routed edge, ready to draw. */
export interface DiagramEdge {
	connection: ArchitectureConnection;
	/** SVG `d` attribute, an orthogonal path under the grid and a curve under organic. */
	d: string;
	id: string;
	/** Where the label sits, or null when the edge carries none. */
	labelAt: DiagramPoint | null;
	points: readonly DiagramPoint[];
}

/**
 * A boundary frame with its title band.
 *
 * `x`/`y`/`width`/`height` are the bounding box in both modes — the viewBox is
 * derived from them. `outline` is the closed curve the organic mode draws
 * instead of a rectangle; under the grid it is null and the surface falls back
 * to a rect.
 */
export interface DiagramFrame {
	boundary: ArchitectureBoundary;
	/** How many frames enclose this one, which is the order to paint them in. */
	depth: number;
	height: number;
	/** Composite identity, `kind:label` — what the delta comparator matches on. */
	id: string;
	/**
	 * True when the frame is a cross-cutting set drawn over the regions rather
	 * than one of them, which is the frame a reader has to see *overlapping*
	 * something to understand it.
	 */
	isLens: boolean;
	/** Closed Bézier outline, or null when the frame is a plain rectangle. */
	outline: string | null;
	title: { height: number; width: number; x: number; y: number };
	width: number;
	x: number;
	y: number;
}

/** Everything the SVG surface needs, plus whatever the IR got wrong. */
export interface DiagramLayout {
	edges: readonly DiagramEdge[];
	frames: readonly DiagramFrame[];
	nodes: readonly DiagramNode[];
	/** Placement and reference faults, surfaced rather than silently drawn. */
	problems: readonly string[];
	viewBox: DiagramSize;
}
