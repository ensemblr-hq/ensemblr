/**
 * Merges a workspace's pull request the way the Merge button does and waits for
 * the close-out that merge sets off, so a caller — an agent asked to merge —
 * learns in one answer what happened to the board, the linked issue, and the
 * local base branch.
 */

import type {
	GithubFailure,
	GithubMergeMethod,
} from '../../shared/ipc/contracts/github.ts';
import type { WorkspaceMergeOutcome } from '../../shared/workspace-merge.ts';
import type { GithubService } from '../github';
import type { MergeCloseOutService } from './merge-close-out-service.ts';

/** Reported when `gh pr merge` failed without the service saying why. */
const UNEXPLAINED_MERGE_FAILURE: GithubFailure = {
	code: 'command-failed',
	message: 'gh pr merge failed.',
};

/** Collaborators a workspace merge acts through. */
export interface WorkspaceMergeDeps {
	githubService: Pick<GithubService, 'mergePullRequest'>;
	mergeCloseOutService: MergeCloseOutService;
}

/** Which workspace to merge, where its checkout is, and how to merge it. */
export interface WorkspaceMergeRequest {
	method?: GithubMergeMethod;
	workspaceCwd: string;
	workspaceId: string;
}

/**
 * Merges the workspace's pull request and, once it reads as merged, awaits its
 * close-out. The merge listener has already started that close-out by the time
 * the merge returns, so this joins it rather than running it twice.
 * @param deps - The GitHub service and the merge close-out.
 * @param request - The workspace, its checkout, and the merge method.
 * @returns Merged with the close-out's report, queued, or failed.
 */
export async function mergeWorkspacePullRequest(
	deps: WorkspaceMergeDeps,
	request: WorkspaceMergeRequest,
): Promise<WorkspaceMergeOutcome> {
	const result = await deps.githubService.mergePullRequest(request);
	if (!result.merged) {
		return {
			failure: result.error ?? UNEXPLAINED_MERGE_FAILURE,
			status: 'failed',
		};
	}
	const pullRequestNumber = result.pullRequestNumber ?? null;
	if (pullRequestNumber === null) {
		return { status: 'queued' };
	}
	const report = await deps.mergeCloseOutService.closeOut({
		pullRequestNumber,
		workspaceId: request.workspaceId,
	});
	return {
		baseSync: report.baseSync,
		issue: report.issue.status,
		pullRequestNumber,
		status: 'merged',
	};
}
