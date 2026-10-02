/** Where a candidate path sits relative to the managed root it was checked against. */
export type ManagedChildVerdict = 'ok' | 'outside' | 'wrong-depth';

/** How deep a repository folder and a workspaces-root slug folder sit under their managed root. */
export const MANAGED_CHILD_DEPTH = 1;

/**
 * Classifies a path against the managed root it is expected to sit under, so
 * the main process and the renderer decide "is this ours to remove" from one
 * rule instead of two that can drift apart.
 *
 * Hand-rolled rather than delegated to `node:path`, which this module may not
 * import because the renderer bundles it. It compares the strings it is handed
 * and resolves nothing: main canonicalizes both sides first, which is what
 * stops a symlink walking a removal out of the tree, while the renderer's
 * answer is only a hint for whether to offer the choice at all. A `.` or `..`
 * segment is refused rather than walked — a caller that has canonicalized
 * cannot produce one, so seeing one means the input was never resolved.
 * @param options - Candidate path, the managed root it must sit under, and how deep
 * @returns `ok` when the path is a managed child, otherwise why it is not
 */
export function classifyManagedChild({
	candidatePath,
	expectedDepth,
	root,
}: {
	candidatePath: string;
	expectedDepth: number;
	root: string;
}): ManagedChildVerdict {
	const trimmedRoot = trimTrailingSeparators(root);
	if (!trimmedRoot || !candidatePath.startsWith(`${trimmedRoot}/`)) {
		return 'outside';
	}

	const segments = trimTrailingSeparators(candidatePath)
		.slice(trimmedRoot.length + 1)
		.split('/');

	if (segments.some(isUnresolvedSegment)) {
		return 'outside';
	}

	return segments.length === expectedDepth ? 'ok' : 'wrong-depth';
}

/**
 * Reports whether a path segment shows the path was never resolved — an empty
 * segment from a doubled separator, or a relative hop.
 * @param segment - One segment of the path below the managed root
 * @returns True when the segment must not be admitted
 */
function isUnresolvedSegment(segment: string): boolean {
	return segment === '' || segment === '.' || segment === '..';
}

/**
 * Strips trailing separators so a root written with one compares equal to a
 * candidate written without.
 * @param value - Path to trim
 * @returns The path without its trailing separators
 */
function trimTrailingSeparators(value: string): string {
	return value.replace(/\/+$/, '');
}
