import type {
	PullRequestCheckSummary,
	PullRequestCommentSummary,
	PullRequestGitStatusSummary,
	PullRequestPreviewDeploymentSummary,
	PullRequestShellStatus,
	PullRequestTodoSummary,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import { deriveOpenPullRequestStatus } from '@/shared/github-pr-presentation';
import type {
	GithubCheckWire,
	GithubCommentWire,
	GithubDeploymentWire,
	GithubPullRequestSnapshotWire,
	GithubPullRequestWire,
} from '@/shared/ipc/contracts/github';
import type {
	ReviewCommentWire,
	ReviewTodoWire,
} from '@/shared/ipc/contracts/review-comments';

/** Inputs for building the workspace shell PR model: local changes, review rows, and the gh snapshot. */
interface BuildPullRequestShellModelInput {
	changeSummary: WorkspaceShellModel['changeSummary'];
	localComments: readonly ReviewCommentWire[];
	snapshot: GithubPullRequestSnapshotWire | null;
	syncError?: string;
	todos: readonly ReviewTodoWire[];
}

/**
 * Maps the gh snapshot + local review rows into the workspace shell PR model
 * the right sidebar header and Checks panel already render. Preserves the
 * documented state contract: empty, create-PR (uncommitted), PR working,
 * PR checking, PR blocked, PR ready, and PR open.
 */
export function buildPullRequestShellModel({
	changeSummary,
	localComments,
	snapshot,
	syncError,
	todos,
}: BuildPullRequestShellModelInput): WorkspaceShellModel['pullRequest'] {
	const gitStatus = buildGitStatus(changeSummary, snapshot);
	const todoSummaries = buildTodoSummaries(todos);
	const localCommentSummaries = buildLocalCommentSummaries(localComments);
	const pullRequest = snapshot?.pullRequest ?? null;

	if (!snapshot || !pullRequest) {
		return {
			checks: [],
			comments: localCommentSummaries,
			description: [],
			detail: syncError
				? `Could not refresh GitHub state: ${syncError}`
				: 'No pull request for this branch yet.',
			gitStatus,
			label: 'No PR',
			status: 'idle',
			...(syncError ? { syncError } : {}),
			...(snapshot ? { syncedAt: snapshot.syncedAt } : {}),
			title: '',
			todos: todoSummaries,
		};
	}

	const checks = pullRequest.checks.map(toCheckSummary);
	const status = derivePullRequestStatus(pullRequest);
	const previewDeployment = derivePreviewDeployment(
		pullRequest.deployments,
		checks,
	);

	return {
		checks,
		comments: [
			...pullRequest.comments.map(toCommentSummary),
			...localCommentSummaries,
		],
		description: pullRequest.body
			? pullRequest.body.split(/\n{2,}/).slice(0, 6)
			: [],
		detail: deriveDetail({ pullRequest, status, syncError }),
		gitStatus,
		label: deriveLabel(pullRequest, status),
		number: pullRequest.number,
		...(previewDeployment ? { previewDeployment } : {}),
		state: pullRequest.state,
		status,
		...(syncError ? { syncError } : {}),
		syncedAt: snapshot.syncedAt,
		title: pullRequest.title,
		todos: todoSummaries,
		url: pullRequest.url,
	};
}

/** Maps wire check buckets onto the panel's blocked/pending/ready statuses. */
function toCheckSummary(check: GithubCheckWire): PullRequestCheckSummary {
	const isPreviewProvider = /vercel|netlify/i.test(
		`${check.name} ${check.workflowName ?? ''}`,
	);
	return {
		...(formatDuration(check.startedAt, check.completedAt)
			? { durationLabel: formatDuration(check.startedAt, check.completedAt) }
			: {}),
		id: check.id,
		label: check.name,
		provider: isPreviewProvider ? 'vercel' : 'github',
		status:
			check.bucket === 'failing'
				? 'blocked'
				: check.bucket === 'pending'
					? 'pending'
					: 'ready',
		...(check.detailsUrl ? { url: check.detailsUrl } : {}),
	};
}

/**
 * Maps a GitHub PR comment into the shell comment summary, folding its path and
 * line into the detail line.
 * @param comment - The GitHub comment wire record
 * @returns The PR comment summary for the sidebar
 */
function toCommentSummary(
	comment: GithubCommentWire,
): PullRequestCommentSummary {
	const location = comment.path
		? ` (${comment.path}${comment.line ? `:${comment.line}` : ''})`
		: '';
	return {
		author: comment.author,
		detail: `${comment.author}: ${firstLine(comment.body)}${location}`,
		id: comment.id,
		...(comment.isResolved === null ? {} : { isResolved: comment.isResolved }),
		provider: 'github',
		...(comment.url ? { url: comment.url } : {}),
	};
}

/**
 * Projects open local review comments into shell comment summaries, dropping
 * resolved ones.
 * @param comments - Local review comment wire records
 * @returns Summaries for the still-open local comments
 */
function buildLocalCommentSummaries(
	comments: readonly ReviewCommentWire[],
): PullRequestCommentSummary[] {
	return comments.flatMap((comment) =>
		comment.status === 'open'
			? [
					{
						detail: `${comment.filePath}${
							comment.lineNumber ? `:${comment.lineNumber}` : ''
						} — ${firstLine(comment.body)}`,
						id: `local:${comment.id}`,
						provider: 'local' as const,
					},
				]
			: [],
	);
}

/**
 * Projects review todos into shell todo summaries, dropping canceled ones.
 * @param todos - Review todo wire records
 * @returns Summaries for the non-canceled todos
 */
function buildTodoSummaries(
	todos: readonly ReviewTodoWire[],
): PullRequestTodoSummary[] {
	return todos.flatMap((todo) =>
		todo.status !== 'canceled'
			? [
					{
						id: todo.id,
						label: todo.title,
						status:
							todo.status === 'done' ? ('done' as const) : ('open' as const),
					},
				]
			: [],
	);
}

/**
 * Derives the PR shell status by delegating to the shared open-PR derivation,
 * so this header model and the cached sidebar rows stay in lockstep. Only the
 * shell-status mapping (`ready` → `ready-to-merge`, draft/open → `idle`) lives
 * here; the underlying policy lives once in `deriveOpenPullRequestStatus`.
 * @param pullRequest - The pull request wire record.
 * @returns The shell status for the PR header.
 */
function derivePullRequestStatus(
	pullRequest: GithubPullRequestWire,
): PullRequestShellStatus {
	if (pullRequest.state !== 'open') {
		return 'idle';
	}
	switch (deriveOpenPullRequestStatus(pullRequest)) {
		case 'blocked':
			return 'blocked';
		case 'checking':
			return 'checking';
		case 'ready':
			return 'ready-to-merge';
		default:
			return 'idle';
	}
}

/**
 * Derives the PR header label from the pull request state and shell status.
 * @param pullRequest - The GitHub pull request wire record
 * @param status - The derived PR shell status
 * @returns The header label to display
 */
function deriveLabel(
	pullRequest: GithubPullRequestWire,
	status: PullRequestShellStatus,
): string {
	if (pullRequest.state === 'merged') {
		return 'Merged';
	}
	if (pullRequest.state === 'closed') {
		return 'Closed';
	}
	if (pullRequest.isDraft) {
		return 'Draft';
	}
	switch (status) {
		case 'ready-to-merge':
			return 'Ready to merge';
		case 'blocked':
			return 'Blocked';
		case 'checking':
			return 'Checks running';
		default:
			return '';
	}
}

/**
 * Derives the PR detail line, preferring a sync-error message when one is present.
 * @param options - The pull request, its shell status, and any sync error
 * @returns The detail line to display
 */
function deriveDetail({
	pullRequest,
	status,
	syncError,
}: {
	pullRequest: GithubPullRequestWire;
	status: PullRequestShellStatus;
	syncError?: string;
}): string {
	if (syncError) {
		return `Could not refresh GitHub state: ${syncError}`;
	}
	if (pullRequest.state === 'merged') {
		return 'This pull request has been merged.';
	}
	if (pullRequest.state === 'closed') {
		return 'This pull request was closed without merging.';
	}
	switch (status) {
		case 'ready-to-merge':
			return 'All required checks passed.';
		case 'blocked':
			return pullRequest.mergeable === 'conflicting'
				? 'Merge conflicts must be resolved.'
				: 'Resolve failing checks or review blockers before merge.';
		case 'checking':
			return 'Checks are still running.';
		default:
			return pullRequest.isDraft
				? 'Draft pull request — mark ready for review to run policy gates.'
				: 'Pull request is open.';
	}
}

/**
 * Picks the preview deployment: GitHub deployment statuses first, preview
 * provider check links second (v1 source order from the ENS-056 discovery).
 */
function derivePreviewDeployment(
	deployments: readonly GithubDeploymentWire[],
	checks: readonly PullRequestCheckSummary[],
): PullRequestPreviewDeploymentSummary | undefined {
	const deployment = deployments.find((entry) => entry.url);
	if (deployment?.url) {
		return {
			label: deployment.environment || 'Preview',
			provider: inferDeploymentProvider(deployment.url),
			source: 'github-deployment',
			status:
				deployment.state === 'failure'
					? 'blocked'
					: deployment.state === 'pending'
						? 'pending'
						: 'ready',
			url: deployment.url,
		};
	}

	const previewCheck = checks.find(
		(check) => check.provider === 'vercel' && check.url,
	);
	if (previewCheck?.url) {
		return {
			label: previewCheck.label,
			provider: inferDeploymentProvider(previewCheck.url),
			source: 'check-link',
			status: previewCheck.status,
			url: previewCheck.url,
		};
	}
	return undefined;
}

/**
 * Infers the preview deployment provider from a deployment URL.
 * @param url - The deployment URL
 * @returns The detected provider, or `'unknown'` when none matches
 */
function inferDeploymentProvider(
	url: string,
): PullRequestPreviewDeploymentSummary['provider'] {
	if (/vercel/i.test(url)) {
		return 'vercel';
	}
	if (/netlify/i.test(url)) {
		return 'netlify';
	}
	return 'unknown';
}

/** Builds the git-status row from local change counts + branch sync state. */
function buildGitStatus(
	changeSummary: WorkspaceShellModel['changeSummary'],
	snapshot: GithubPullRequestSnapshotWire | null,
): PullRequestGitStatusSummary {
	if (changeSummary.files > 0) {
		return {
			actionLabel: 'Commit and push',
			label: `${changeSummary.files} uncommitted change${
				changeSummary.files === 1 ? '' : 's'
			}`,
			status: 'pending',
		};
	}
	const branchSync = snapshot?.branchSync;
	if (branchSync && !branchSync.hasUpstream) {
		return {
			actionLabel: 'Push branch',
			label: 'Branch not pushed yet',
			status: 'pending',
		};
	}
	if (branchSync && branchSync.ahead > 0) {
		return {
			actionLabel: 'Push',
			label: `${branchSync.ahead} unpushed commit${
				branchSync.ahead === 1 ? '' : 's'
			}`,
			status: 'pending',
		};
	}
	return {
		label: 'Up to date with remote',
		status: 'open',
	};
}

/**
 * Formats the elapsed time between two ISO timestamps as `Xs` or `Xm Ys`.
 * @param startedAt - ISO start timestamp
 * @param completedAt - ISO completion timestamp
 * @returns The formatted duration, or undefined when a bound is missing or invalid
 */
function formatDuration(
	startedAt?: string,
	completedAt?: string,
): string | undefined {
	if (!startedAt || !completedAt) {
		return undefined;
	}
	const elapsedMs = Date.parse(completedAt) - Date.parse(startedAt);
	if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
		return undefined;
	}
	const seconds = Math.round(elapsedMs / 1000);
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${seconds % 60}s`;
}

/**
 * Returns the first line of a multi-line string.
 * @param text - The text to read
 * @returns The text up to the first newline
 */
function firstLine(text: string): string {
	return text.split('\n', 1)[0] ?? '';
}
