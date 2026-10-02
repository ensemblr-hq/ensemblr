/**
 * Labels for the file chips the timeline draws.
 *
 * A chip is narrow, so it shows a file name rather than a path — which is
 * ambiguous exactly when it matters, because a turn that moves a file, or edits
 * the `index.ts` of two concerns, renders two chips reading the same word for
 * two different files. {@link chipLabelsForPaths} resolves a whole set at once
 * and lengthens only the labels that would otherwise collide.
 */

/** Path split into its segments, with any trailing separator dropped. */
function pathSegments(path: string): readonly string[] {
	return path.replace(/\/+$/, '').split('/');
}

/**
 * The chip label for one path on its own: its file name.
 * @param path - Workspace-relative or absolute path
 * @returns The final path segment
 */
export function chipLabelForPath(path: string): string {
	return pathSegments(path).at(-1) ?? path;
}

/**
 * Labels a set of paths, giving each the shortest trailing run of segments that
 * no other path in the set shares.
 *
 * Only a name that collides grows, and it grows one segment at a time, so a
 * turn touching `tests/main/x.test.ts` and `tests/renderer/x.test.ts` reads
 * `main/x.test.ts` and `renderer/x.test.ts` while everything around them stays
 * a bare file name. A path shorter than the run being tried contributes itself,
 * which is unique by construction and ends the widening.
 * @param paths - The paths rendered together, duplicates tolerated
 * @returns Each distinct path mapped to its label
 */
export function chipLabelsForPaths(
	paths: Iterable<string>,
): ReadonlyMap<string, string> {
	const distinct = [...new Set(paths)];
	const labels = new Map<string, string>();
	for (const group of groupByLabel(distinct, 1).values()) {
		widenGroup(group, 1, labels);
	}
	return labels;
}

/**
 * Buckets paths by the label `depth` trailing segments would give them.
 * @param paths - Paths to bucket
 * @param depth - How many trailing segments the label spans
 * @returns Candidate label mapped to the paths claiming it
 */
function groupByLabel(
	paths: readonly string[],
	depth: number,
): ReadonlyMap<string, readonly string[]> {
	const groups = new Map<string, string[]>();
	for (const path of paths) {
		const label = pathSegments(path).slice(-depth).join('/');
		groups.set(label, [...(groups.get(label) ?? []), path]);
	}
	return groups;
}

/**
 * Records the label for every path in a group, re-splitting on a longer run of
 * segments while more than one path still claims the same label.
 * @param group - Paths currently sharing a label
 * @param depth - Segment count that produced that shared label
 * @param labels - Accumulator the resolved labels are written into
 */
function widenGroup(
	group: readonly string[],
	depth: number,
	labels: Map<string, string>,
): void {
	const [only] = group;
	if (group.length === 1 && only !== undefined) {
		labels.set(only, pathSegments(only).slice(-depth).join('/'));
		return;
	}
	if (group.every((path) => pathSegments(path).length <= depth)) {
		for (const path of group) {
			labels.set(path, path);
		}
		return;
	}
	for (const wider of groupByLabel(group, depth + 1).values()) {
		widenGroup(wider, depth + 1, labels);
	}
}
