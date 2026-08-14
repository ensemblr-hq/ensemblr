import { i18n } from '@/renderer/lib/i18n';
import type {
	CommandFailureCopy,
	PullRequestCheckSummary,
	PullRequestCommentReplySummary,
	PullRequestCommentSummary,
	PullRequestGitStatusSummary,
	PullRequestShellStatus,
	PullRequestTodoSummary,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import { deriveOpenPullRequestStatus } from '@/shared/github-pr-presentation';
import type {
	GithubCheckWire,
	GithubCommentWire,
	GithubFailure,
	GithubPullRequestSnapshotWire,
	GithubPullRequestWire,
} from '@/shared/ipc/contracts/github';
import type {
	ReviewCommentWire,
	ReviewTodoWire,
} from '@/shared/ipc/contracts/review-comments';
import {
	describeComment,
	formatCommentLocation,
	stripCommentMetadata,
	summarizeCommentBody,
} from './comment-body';
import { describeCommandFailure } from './git-failure-copy';
import { derivePreviewDeployment } from './preview-deployment';

/** Inputs for building the workspace shell PR model: local changes, review rows, and the gh snapshot. */
interface BuildPullRequestShellModelInput {
	changeSummary: WorkspaceShellModel['changeSummary'];
	localComments: readonly ReviewCommentWire[];
	snapshot: GithubPullRequestSnapshotWire | null;
	/** The coded failure the last gh refresh reported, when one failed. */
	syncFailure?: GithubFailure;
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
	syncFailure,
	todos,
}: BuildPullRequestShellModelInput): WorkspaceShellModel['pullRequest'] {
	const gitStatus = buildGitStatus(changeSummary, snapshot);
	const todoSummaries = buildTodoSummaries(todos);
	const localCommentSummaries = buildLocalCommentSummaries(localComments);
	const pullRequest = snapshot?.pullRequest ?? null;
	const syncError = syncFailure
		? describeCommandFailure(syncFailure)
		: undefined;

	if (!snapshot || !pullRequest) {
		return {
			checks: [],
			comments: localCommentSummaries,
			description: [],
			detail: syncError
				? syncErrorDetail(syncError.message)
				: i18n.t(
						'git:pull-request.detail.no-pull-request',
						'No pull request for this branch yet.',
					),
			gitStatus,
			label: i18n.t('git:pull-request.label.no-pull-request', 'No PR'),
			status: 'idle',
			...(syncError ? { syncError } : {}),
			...(snapshot ? { syncedAt: snapshot.syncedAt } : {}),
			title: '',
			todos: todoSummaries,
		};
	}

	const checks = pullRequest.checks.map(toCheckSummary);
	const status = derivePullRequestStatus(pullRequest);
	const previewDeployment = derivePreviewDeployment({
		checks,
		comments: pullRequest.comments,
		deployments: pullRequest.deployments,
	});

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
		isConflicting: pullRequest.mergeable === 'conflicting',
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
 * Maps a GitHub PR comment into the shell comment summary, carrying the whole
 * thread so the preview can render it. The body is stripped of the metadata bots
 * hide in it, and the row's detail line is the first prose that survives.
 * @param comment - The GitHub comment wire record
 * @returns The PR comment summary for the sidebar
 */
function toCommentSummary(
	comment: GithubCommentWire,
): PullRequestCommentSummary {
	const body = stripCommentMetadata(comment.body);
	const replies = (comment.replies ?? []).map(toCommentReplySummary);
	const anchor = toCommentAnchor(comment);
	return {
		...anchor,
		author: comment.author,
		body,
		...(comment.createdAt ? { createdAt: comment.createdAt } : {}),
		detail: describeComment({ ...anchor, body, replies }),
		id: comment.id,
		...(comment.isOutdated === undefined
			? {}
			: { isOutdated: comment.isOutdated }),
		...(comment.isResolved === null ? {} : { isResolved: comment.isResolved }),
		provider: comment.isBot ? 'github-actions' : 'github',
		...(replies.length > 0 ? { replies } : {}),
		...(comment.url ? { url: comment.url } : {}),
	};
}

/**
 * Reads the diff anchor a review thread carries, as summary fields.
 * @param comment - The GitHub comment wire record
 * @returns The comment's `path` and `line`, when it has them
 */
function toCommentAnchor(comment: GithubCommentWire): {
	line?: number;
	path?: string;
} {
	return {
		...(comment.line === undefined ? {} : { line: comment.line }),
		...(comment.path ? { path: comment.path } : {}),
	};
}

/**
 * Maps a review-thread reply into the summary shape the preview renders under
 * the head comment.
 * @param reply - The reply's GitHub comment wire record
 * @returns The reply summary
 */
function toCommentReplySummary(
	reply: GithubCommentWire,
): PullRequestCommentReplySummary {
	return {
		author: reply.author,
		body: stripCommentMetadata(reply.body),
		...(reply.createdAt ? { createdAt: reply.createdAt } : {}),
		id: reply.id,
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
						body: comment.body,
						createdAt: comment.createdAt,
						detail: `${formatCommentLocation(
							comment.filePath,
							comment.lineNumber ?? undefined,
						)} — ${summarizeCommentBody(comment.body)}`,
						id: `local:${comment.id}`,
						...(comment.lineNumber === null
							? {}
							: { line: comment.lineNumber }),
						path: comment.filePath,
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
		return i18n.t('git:pull-request.label.merged', 'Merged');
	}
	if (pullRequest.state === 'closed') {
		return i18n.t('git:pull-request.label.closed', 'Closed');
	}
	if (pullRequest.isDraft) {
		return i18n.t('git:pull-request.label.draft', 'Draft');
	}
	switch (status) {
		case 'ready-to-merge':
			return i18n.t('git:pull-request.label.ready-to-merge', 'Ready to merge');
		case 'blocked':
			// `blocked` covers failing checks, requested changes, and conflicts
			// alike; name the conflict, because it is the one a reviewer resolves
			// here rather than on GitHub.
			return pullRequest.mergeable === 'conflicting'
				? i18n.t('git:pull-request.label.conflicts', 'Merge conflicts')
				: i18n.t('git:pull-request.label.blocked', 'Blocked');
		case 'checking':
			return i18n.t('git:pull-request.label.checking', 'Checks running');
		default:
			return '';
	}
}

/**
 * Renders the detail line shown when the gh refresh itself failed.
 * @param message - The translated explanation of the refresh failure
 * @returns The detail line naming the refresh failure
 */
function syncErrorDetail(message: string): string {
	return i18n.t(
		'git:pull-request.detail.sync-failed',
		'Could not refresh GitHub state: {{error}}',
		{ error: message },
	);
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
	syncError?: CommandFailureCopy;
}): string {
	if (syncError) {
		return syncErrorDetail(syncError.message);
	}
	if (pullRequest.state === 'merged') {
		return i18n.t(
			'git:pull-request.detail.merged',
			'This pull request has been merged.',
		);
	}
	if (pullRequest.state === 'closed') {
		return i18n.t(
			'git:pull-request.detail.closed',
			'This pull request was closed without merging.',
		);
	}
	switch (status) {
		case 'ready-to-merge':
			return i18n.t(
				'git:pull-request.detail.ready-to-merge',
				'All required checks passed.',
			);
		case 'blocked':
			return pullRequest.mergeable === 'conflicting'
				? i18n.t(
						'git:pull-request.detail.conflicting',
						'Merge conflicts must be resolved.',
					)
				: i18n.t(
						'git:pull-request.detail.blocked',
						'Resolve failing checks or review blockers before merge.',
					);
		case 'checking':
			return i18n.t(
				'git:pull-request.detail.checking',
				'Checks are still running.',
			);
		default:
			return pullRequest.isDraft
				? i18n.t(
						'git:pull-request.detail.draft',
						'Draft pull request — mark ready for review to run policy gates.',
					)
				: i18n.t('git:pull-request.detail.open', 'Pull request is open.');
	}
}

/** Builds the git-status row from local change counts + branch sync state. */
function buildGitStatus(
	changeSummary: WorkspaceShellModel['changeSummary'],
	snapshot: GithubPullRequestSnapshotWire | null,
): PullRequestGitStatusSummary {
	if (changeSummary.files > 0) {
		return {
			actionLabel: i18n.t(
				'git:git-status.action.commit-push',
				'Commit and push',
			),
			kind: 'uncommitted',
			label: i18n.t('git:git-status.uncommitted', {
				count: changeSummary.files,
				defaultValue_one: '{{count}} uncommitted change',
				defaultValue_other: '{{count}} uncommitted changes',
			}),
			status: 'pending',
		};
	}
	const branchSync = snapshot?.branchSync;
	if (branchSync && !branchSync.hasUpstream) {
		return {
			actionLabel: i18n.t('git:git-status.action.push-branch', 'Push branch'),
			kind: 'unpublished',
			label: i18n.t('git:git-status.unpublished', 'Branch not pushed yet'),
			status: 'pending',
		};
	}
	if (branchSync && branchSync.ahead > 0) {
		return {
			actionLabel: i18n.t('git:git-status.action.push', 'Push'),
			kind: 'unpushed',
			label: i18n.t('git:git-status.unpushed', {
				count: branchSync.ahead,
				defaultValue_one: '{{count}} unpushed commit',
				defaultValue_other: '{{count}} unpushed commits',
			}),
			status: 'pending',
		};
	}
	return {
		kind: 'clean',
		label: i18n.t('git:git-status.clean', 'Up to date with remote'),
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
