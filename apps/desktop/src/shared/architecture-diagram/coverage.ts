/**
 * Answers which parts of a diagram a set of changed files falls under.
 *
 * This is what lets the app tell a refactor the diagram cares about from one it
 * does not. A component's `sources` is the only claim it makes on the tree, so
 * a changed path inside one is the single honest signal that the drawing may
 * have gone out of date — and a changed path outside every one of them is not
 * evidence of anything, which is what stops the upkeep nudge firing on every
 * turn that touched a test fixture.
 *
 * Pure and free of any filesystem access, so the matching rule is unit-testable
 * on its own and the main process is left holding only the reads.
 */
import type { ArchitectureIR } from './types.ts';

/** Which components a change set lands in, and which of its paths landed there. */
export interface ArchitectureCoverage {
	/** Labels of the components claiming at least one changed path, in document order. */
	labels: readonly string[];
	/** The changed paths at least one component claims. */
	paths: readonly string[];
}

/** Coverage of a change set that touched nothing the diagram draws. */
const NOTHING_COVERED: ArchitectureCoverage = { labels: [], paths: [] };

/**
 * Normalizes a workspace-relative path so the two sides of a comparison agree:
 * forward slashes, no `./` prefix, no leading or trailing separator.
 * @param value - A path as it was written in the diagram or reported by git
 * @returns The comparable form, empty when the path was only separators
 */
function normalizePath(value: string): string {
	return value
		.replaceAll('\\', '/')
		.replace(/^\.\//, '')
		.replace(/^\/+/, '')
		.replace(/\/+$/, '');
}

/**
 * Reports whether a changed path falls under what one component source claims.
 *
 * Matched on segment boundaries rather than by prefix: `src/main` claims
 * `src/main/app.ts` and must never claim `src/maintenance/app.ts`, which a bare
 * `startsWith` would hand it.
 * @param sourcePath - Normalized path a component's `sources` entry names
 * @param changedPath - Normalized path git reported as changed
 * @returns True when the source covers that change
 */
function sourceClaims(sourcePath: string, changedPath: string): boolean {
	if (sourcePath.length === 0) {
		return false;
	}
	return changedPath === sourcePath || changedPath.startsWith(`${sourcePath}/`);
}

/**
 * Finds the parts of a diagram a change set lands in.
 * @param ir - The stored diagram to measure the change set against
 * @param changedPaths - Workspace-relative paths git reports as changed
 * @returns The components claiming those paths and the paths they claim
 */
export function coverChangedPaths(
	ir: ArchitectureIR,
	changedPaths: readonly string[],
): ArchitectureCoverage {
	const changed = changedPaths.flatMap((one) => {
		const normalized = normalizePath(one);
		return normalized === '' ? [] : [normalized];
	});
	if (changed.length === 0) {
		return NOTHING_COVERED;
	}
	const labels: string[] = [];
	const paths = new Set<string>();
	for (const component of ir.components) {
		const sources = (component.sources ?? []).map((source) =>
			normalizePath(source.path),
		);
		const claimed = changed.filter((one) =>
			sources.some((source) => sourceClaims(source, one)),
		);
		if (claimed.length === 0) {
			continue;
		}
		labels.push(component.label);
		for (const one of claimed) {
			paths.add(one);
		}
	}
	return { labels, paths: [...paths] };
}
