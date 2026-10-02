/**
 * Grid placement for the architecture IR.
 *
 * Ported from archify's `renderers/architecture/grid.mjs`.
 * Copyright (c) archify contributors. Licensed under the MIT License.
 *
 * Not auto-layout — a component names a `row`/`col` and this turns that into a
 * point; nothing here moves a node to avoid another. What the port does not
 * keep is the uniform cell: the offsets come from {@link resolveGridTracks},
 * which sizes each track from the content sitting on it.
 */
import type {
	ArchitectureComponent,
	ArchitectureIR,
	DiagramPoint,
} from '@/shared/architecture-diagram';

import { MAX_GRID_TRACKS, type ResolvedGrid } from './tracks';

/** The component holding a corner, and the cell it named to get there. */
interface Occupant {
	/** Its `row R col C`, or null when it was placed by an explicit `pos`. */
	cell: string | null;
	id: string;
}

/**
 * Resolves a component's top-left corner. An explicit `pos` always wins;
 * otherwise `row`/`col` select a track offset.
 * @param component - The component to place
 * @param grid - The document's resolved grid, or null under free placement
 * @returns The corner, or `[NaN, NaN]` when the component names no placement
 */
export function resolveComponentPos(
	component: ArchitectureComponent,
	grid: ResolvedGrid | null,
): DiagramPoint {
	if (component.pos) {
		return component.pos;
	}
	if (!grid) {
		return [Number.NaN, Number.NaN];
	}
	if (
		!Number.isInteger(component.row) ||
		!Number.isInteger(component.col) ||
		component.row === undefined ||
		component.col === undefined
	) {
		return [Number.NaN, Number.NaN];
	}
	const x = grid.colX[component.col];
	const y = grid.rowY[component.row];
	return x === undefined || y === undefined ? [Number.NaN, Number.NaN] : [x, y];
}

/**
 * The cell a component names, as it reads in a message.
 * @param component - The component to describe
 * @returns Its `row R col C`, or null when it was placed by an explicit `pos`
 */
function cellLabel(component: ArchitectureComponent): string | null {
	return component.pos
		? null
		: `row ${component.row ?? 0} col ${component.col ?? 0}`;
}

/**
 * Reports a component whose cell the resolved grid has no track for, which is
 * either a column past the declared width or an index past the ceiling
 * {@link MAX_GRID_TRACKS} puts on the allocation.
 * @param component - The component to check
 * @param grid - The document's resolved grid
 * @returns One message per out-of-range axis
 */
function rangeFaults(
	component: ArchitectureComponent,
	grid: ResolvedGrid,
): string[] {
	const row = component.row ?? 0;
	const col = component.col ?? 0;
	const faults: string[] = [];
	if (col >= grid.colX.length) {
		faults.push(
			`Component "${component.id}" col ${col} exceeds the ${MAX_GRID_TRACKS} columns a diagram can hold (valid: 0..${grid.colX.length - 1}).`,
		);
	} else if (col >= grid.cols) {
		faults.push(
			`Component "${component.id}" col ${col} exceeds layout.cols ${grid.cols} (valid: 0..${grid.cols - 1}).`,
		);
	}
	if (row >= grid.rowY.length) {
		faults.push(
			`Component "${component.id}" row ${row} exceeds the ${MAX_GRID_TRACKS} rows a diagram can hold (valid: 0..${grid.rowY.length - 1}).`,
		);
	}
	return faults;
}

/**
 * Reports what a component's cell gets wrong: naming no placement at all, a
 * negative index, or one the grid has no track for.
 * @param component - The component to check
 * @param grid - The document's resolved grid
 * @returns One message per fault
 */
function cellFaults(
	component: ArchitectureComponent,
	grid: ResolvedGrid,
): string[] {
	if (component.pos) {
		return [];
	}
	if (!Number.isInteger(component.row) || !Number.isInteger(component.col)) {
		return [`Component "${component.id}" needs pos [x,y] or grid row/col.`];
	}
	if ((component.row ?? 0) < 0 || (component.col ?? 0) < 0) {
		return [
			`Component "${component.id}" row/col must be non-negative integers.`,
		];
	}
	return rangeFaults(component, grid);
}

/**
 * Reports two components resolving to the same corner.
 * @param occupant - Whoever claimed the corner first
 * @param component - The component arriving on top of it
 * @param corner - The corner they share
 * @returns The message describing the collision
 */
function overlapFault(
	occupant: Occupant,
	component: ArchitectureComponent,
	corner: DiagramPoint,
): string {
	const cell = cellLabel(component);
	return cell !== null && cell === occupant.cell
		? `Components "${occupant.id}" and "${component.id}" share grid cell ${cell}.`
		: `Components "${occupant.id}" and "${component.id}" are placed at the same point [${corner[0]}, ${corner[1]}].`;
}

/**
 * Reports every placement fault in a document — a component with neither `pos`
 * nor a cell, a negative or out-of-range cell, two components resolving to one
 * corner. Reported rather than silently drawn, so a bad IR reads as a warning in
 * the panel instead of as overlapping boxes.
 *
 * The collision is keyed on the resolved corner rather than the cell, so the two
 * placement styles are held to the same rule: two components at one `pos` are
 * exactly as invisible on the canvas as two in one cell.
 * @param ir - The document to check
 * @param grid - The document's resolved grid, or null under free placement
 * @returns One message per fault, in component order
 */
export function validateGridPlacement(
	ir: ArchitectureIR,
	grid: ResolvedGrid | null,
): readonly string[] {
	const problems: string[] = [];
	const seen = new Map<string, Occupant>();
	for (const component of ir.components) {
		if (grid) {
			problems.push(...cellFaults(component, grid));
		}
		const corner = resolveComponentPos(component, grid);
		if (!Number.isFinite(corner[0]) || !Number.isFinite(corner[1])) {
			continue;
		}
		const key = `${corner[0]},${corner[1]}`;
		const occupant = seen.get(key);
		if (occupant) {
			problems.push(overlapFault(occupant, component, corner));
		} else {
			seen.set(key, { cell: cellLabel(component), id: component.id });
		}
	}
	return problems;
}
