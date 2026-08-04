import type { ReviewFileSummary } from '@/renderer/types/workbench';
import type { WorkspaceGitFileWire } from '@/shared/ipc/contracts/workspace-git';

/**
 * Maps git status wire rows to the review panel's changed-file summaries.
 * Ignored files are dropped; conflicted files render as modified (the review
 * surface has no distinct conflict affordance). Shared by the live workspace
 * model and the Changes-tab source query so both derive rows identically.
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
						status:
							file.status === 'conflicted'
								? ('modified' as const)
								: file.status,
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
