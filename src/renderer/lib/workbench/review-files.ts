import type { ReviewFileSummary } from '@/renderer/types/workbench';
import type { WorkspaceGitFileWire } from '@/shared/ipc/contracts/workspace-git';

/**
 * Maps git status wire rows to the review panel's changed-file summaries.
 * Ignored files are dropped; every other status carries through, conflicts
 * included. Shared by the live workspace model and the Changes-tab source query
 * so both derive rows identically.
 */
export function mapGitStatusToReviewFiles(
	files: readonly WorkspaceGitFileWire[],
): ReviewFileSummary[] {
	return files.flatMap((file) =>
		file.status === 'ignored'
			? []
			: [
					{
						additions: file.additions ?? 0,
						contentId: file.contentId ?? null,
						deletions: file.deletions ?? 0,
						id: `git:${file.path}`,
						path: file.path,
						...(file.renamedFrom ? { renamedFrom: file.renamedFrom } : {}),
						status: file.status,
					},
				],
	);
}

/**
 * Fingerprint of what a changed file currently contains, used to expire a
 * "viewed" mark once the file changes again. The Changes list and the diff
 * toolbar both derive it from the same git-status query, so a mark set from one
 * is recognized by the other.
 *
 * `contentId` is what makes this track content rather than shape: status and
 * line counts alone survive the two edits a reviewer most needs to catch — a
 * rewrite that leaves the counts where they were, and any change at all to a
 * binary file, whose counts are always zero. Where the scope has no content
 * stamp to give (a commit, whose content is already frozen) the counts are
 * enough on their own.
 * @param file - The changed-file row to fingerprint
 * @returns An opaque revision string for that row's current state
 */
export function reviewFileRevision(file: ReviewFileSummary): string {
	return `${file.status}:${file.additions}:${file.deletions}:${file.contentId ?? ''}`;
}

/**
 * Revision of one path within a git-status result, or null when the change set
 * does not hold it and there is therefore nothing to mark viewed.
 * @param files - Git status wire rows for the scope being reviewed
 * @param filePath - Workspace-relative path to look up
 * @returns The path's revision, or null when it is not in the change set
 */
export function findReviewFileRevision(
	files: readonly WorkspaceGitFileWire[],
	filePath: string,
): string | null {
	const wireFile = files.find((entry) => entry.path === filePath);
	const [file] = wireFile ? mapGitStatusToReviewFiles([wireFile]) : [];
	return file ? reviewFileRevision(file) : null;
}

/**
 * Restates trial-merge conflicts as row status, so a file that will not merge
 * carries the same mark whether git already flagged it during a real merge or a
 * trial merge only predicted it. Folding the two sources together here is what
 * lets the folder tree — which never sees `conflictPaths` — show conflicts too.
 *
 * @param files - The change set as git reported it.
 * @param conflictPaths - Paths that cannot merge cleanly, if any are known.
 * @returns The same rows, with conflicting ones restated as `conflicted`.
 */
export function markConflictedFiles(
	files: ReviewFileSummary[],
	conflictPaths: ReadonlySet<string> | undefined,
): ReviewFileSummary[] {
	if (!conflictPaths?.size) {
		return files;
	}
	return files.map((file) =>
		conflictPaths.has(file.path) && file.status !== 'conflicted'
			? { ...file, status: 'conflicted' as const }
			: file,
	);
}

/**
 * Splits the change set into the files that will not merge and the rest.
 *
 * Conflicts are taken from `files` rather than `orderedFiles` so they keep their
 * natural order: a file that will not merge is the next thing to act on, and
 * sinking it for having been viewed would bury the work.
 *
 * @param files - The change set in its natural order.
 * @param orderedFiles - The same rows in the order the flat list would show them.
 * @param conflictPaths - Paths that cannot merge cleanly, if any are known.
 * @returns The two groups, or null when nothing in the change set conflicts and
 *   the caller should render one ungrouped list.
 */
export function groupReviewFilesByConflict(
	files: readonly ReviewFileSummary[],
	orderedFiles: readonly ReviewFileSummary[],
	conflictPaths: ReadonlySet<string> | undefined,
): { clean: ReviewFileSummary[]; conflicted: ReviewFileSummary[] } | null {
	if (!conflictPaths?.size) {
		return null;
	}
	const conflicted = files.filter((file) => conflictPaths.has(file.path));
	if (conflicted.length === 0) {
		return null;
	}
	return {
		clean: orderedFiles.filter((file) => !conflictPaths.has(file.path)),
		conflicted,
	};
}

/**
 * Orders changed files with the viewed ones last, keeping the incoming order
 * inside each group so marking a file viewed moves that row and nothing else.
 * @param files - The change set in its natural order
 * @param isViewed - Whether a row is marked viewed at its current revision
 * @returns A new array with unviewed rows first
 */
export function sortReviewFilesByViewed(
	files: readonly ReviewFileSummary[],
	isViewed: (file: ReviewFileSummary) => boolean,
): ReviewFileSummary[] {
	return [
		...files.filter((file) => !isViewed(file)),
		...files.filter((file) => isViewed(file)),
	];
}
