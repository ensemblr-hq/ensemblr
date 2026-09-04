/**
 * Grid placement for the architecture IR.
 *
 * Ported from archify's `renderers/architecture/grid.mjs`.
 * Copyright (c) archify contributors. Licensed under the MIT License.
 *
 * Not auto-layout — fixed cell math only. A component names a `row`/`col` and
 * the grid turns that into a point; nothing here moves a node to avoid another.
 */
import type {
	ArchitectureComponent,
	ArchitectureIR,
	ArchitectureLayout,
	DiagramPoint,
} from '@/shared/architecture-diagram';

/** Every grid dimension, with the defaults an IR inherits when it omits them. */
export interface ResolvedGrid {
	cellH: number;
	cellW: number;
	cols: number;
	gapX: number;
	gapY: number;
	mode: 'grid';
	origin: DiagramPoint;
}

/** The cell geometry an IR inherits when `layout` names only `mode`. */
export const DEFAULT_GRID: ResolvedGrid = {
	cellH: 64,
	cellW: 130,
	cols: 4,
	gapX: 30,
	gapY: 40,
	mode: 'grid',
	origin: [40, 80],
};

/**
 * Resolves the document's grid, filling each omitted dimension from the
 * defaults.
 * @param layout - The IR's `layout` block, if it has one
 * @returns The resolved grid, or null for a free-placement document
 */
export function gridLayout(
	layout: ArchitectureLayout | undefined,
): ResolvedGrid | null {
	if (layout?.mode !== 'grid') {
		return null;
	}
	return { ...DEFAULT_GRID, ...layout };
}

/**
 * Resolves a component's top-left corner. An explicit `pos` always wins;
 * otherwise `row`/`col` are stepped out from the grid origin.
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
	const [originX, originY] = grid.origin;
	return [
		originX + component.col * (grid.cellW + grid.gapX),
		originY + component.row * (grid.cellH + grid.gapY),
	];
}

/**
 * Reports every placement fault in a grid document — a component with neither
 * `pos` nor a cell, a negative or out-of-range cell, two components in one
 * cell. Reported rather than silently drawn, so a bad IR reads as a warning in
 * the panel instead of as overlapping boxes.
 * @param ir - The document to check
 * @param grid - The document's resolved grid, or null under free placement
 * @returns One message per fault, in component order
 */
export function validateGridPlacement(
	ir: ArchitectureIR,
	grid: ResolvedGrid | null,
): readonly string[] {
	if (!grid) {
		return [];
	}
	const problems: string[] = [];
	const seen = new Map<string, string>();
	for (const component of ir.components) {
		if (component.pos) {
			continue;
		}
		const hasCell =
			Number.isInteger(component.row) && Number.isInteger(component.col);
		if (!hasCell) {
			problems.push(
				`Component "${component.id}" needs pos [x,y] or grid row/col.`,
			);
			continue;
		}
		const row = component.row ?? 0;
		const col = component.col ?? 0;
		if (row < 0 || col < 0) {
			problems.push(
				`Component "${component.id}" row/col must be non-negative integers.`,
			);
			continue;
		}
		if (col >= grid.cols) {
			problems.push(
				`Component "${component.id}" col ${col} exceeds layout.cols ${grid.cols} (valid: 0..${grid.cols - 1}).`,
			);
		}
		const key = `${row},${col}`;
		const occupant = seen.get(key);
		if (occupant) {
			problems.push(
				`Components "${occupant}" and "${component.id}" share grid cell row ${row} col ${col}.`,
			);
		} else {
			seen.set(key, component.id);
		}
	}
	return problems;
}
