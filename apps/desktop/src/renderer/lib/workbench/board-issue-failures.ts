/**
 * Folds the Backlog column's per-repository `gh` failures into the rows it
 * renders. Kept out of `lib/workbench/index.ts` for the same reason as its
 * `board-issues` sibling — import it by path.
 */

import type {
	BoardIssuesFailure,
	GroupedBoardIssuesFailure,
} from '@/renderer/types/workbench-shell';

/**
 * Identifies one distinct problem. The code alone is too coarse — `gh` writes a
 * different sentence per repository under the same classification, and the
 * catch-all `command-failed` bucket says nothing without it — so the command's
 * own words are part of what makes two failures the same failure.
 * @param failure - The repository failure to key.
 * @returns A stable key for grouping and for React's list keys.
 */
function failureKey({ failure }: BoardIssuesFailure): string {
	return `${failure.code}\n${failure.output ?? ''}`;
}

/**
 * Groups per-repository failures so several repositories failing the same way
 * read as one problem naming them all, rather than one identical row each.
 * @param failures - Every repository whose issue list failed, in board order.
 * @returns One row per distinct failure, first-seen order, each naming its repositories.
 */
export function groupBoardIssueFailures(
	failures: readonly BoardIssuesFailure[],
): GroupedBoardIssuesFailure[] {
	const grouped = new Map<string, GroupedBoardIssuesFailure>();
	for (const entry of failures) {
		const key = failureKey(entry);
		const existing = grouped.get(key);
		grouped.set(
			key,
			existing
				? {
						failure: existing.failure,
						projectNames: [...existing.projectNames, entry.projectName],
					}
				: { failure: entry.failure, projectNames: [entry.projectName] },
		);
	}
	return [...grouped.values()];
}
