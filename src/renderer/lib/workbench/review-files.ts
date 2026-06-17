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
