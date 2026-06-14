import type { GithubCheckBucket, GithubCheckWire, GithubCommentWire, GithubDeploymentWire, GithubMergeableState, GithubPullRequestState, GithubPullRequestWire } from '../../shared/ipc/contracts/github';

/** JSON fields requested from `gh pr view --json`. */
export const PR_VIEW_JSON_FIELDS = [
	'additions',
	'baseRefName',
	'body',
	'comments',
	'deletions',
	'headRefName',
	'isDraft',
	'mergeStateStatus',
	'mergeable',
	'number',
	'reviewDecision',
	'reviews',
	'state',
	'statusCheckRollup',
	'title',
	'updatedAt',
	'url',
].join(',');

/**
 * Parses `gh pr view --json` stdout into the wire PR model. Throws on
 * malformed JSON so callers can surface a `parse-failed` failure instead of
 * crashing the checks panel (ENS-055).
 */
export function parsePullRequestView(stdout: string): GithubPullRequestWire {
	const raw = JSON.parse(stdout) as Record<string, unknown>;
	const checks = parseStatusCheckRollup(raw.statusCheckRollup);
	const comments = [
		...parseIssueComments(raw.comments),
		...parseReviews(raw.reviews),
	];

	return {
		additions: typeof raw.additions === 'number' ? raw.additions : null,
		baseRefName: readString(raw.baseRefName),
		body: readString(raw.body),
		checks,
		comments,
		deletions: typeof raw.deletions === 'number' ? raw.deletions : null,
		deployments: [],
		headRefName: readString(raw.headRefName),
		isDraft: raw.isDraft === true,
		mergeable: parseMergeable(raw.mergeable),
		...(typeof raw.mergeStateStatus === 'string'
			? { mergeStateStatus: raw.mergeStateStatus }
			: {}),
		number: typeof raw.number === 'number' ? raw.number : 0,
		...(typeof raw.reviewDecision === 'string' && raw.reviewDecision
			? { reviewDecision: raw.reviewDecision }
			: {}),
		state: parseState(raw.state),
		title: readString(raw.title),
		updatedAt: readString(raw.updatedAt),
		url: readString(raw.url),
	};
}

/** Parses `statusCheckRollup` rows (CheckRun and StatusContext nodes). */
export function parseStatusCheckRollup(value: unknown): GithubCheckWire[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((node, index) => {
		if (typeof node !== 'object' || node === null) {
			return [];
		}
		const record = node as Record<string, unknown>;
		const isStatusContext = record.__typename === 'StatusContext';
		const name = readString(
			isStatusContext ? record.context : record.name,
			`check-${index}`,
		);
		const detailsUrl = readString(
			isStatusContext ? record.targetUrl : record.detailsUrl,
		);
		const bucket = isStatusContext
			? bucketFromStatusContext(readString(record.state))
			: bucketFromCheckRun(
					readString(record.status),
					readString(record.conclusion),
				);
		const workflowName = readString(record.workflowName);

		return [
			{
				bucket,
				...(readString(record.completedAt)
					? { completedAt: readString(record.completedAt) }
					: {}),
				...(detailsUrl ? { detailsUrl } : {}),
				id: `${name}:${index}`,
				name,
				...(readString(record.startedAt)
					? { startedAt: readString(record.startedAt) }
					: {}),
				...(workflowName ? { workflowName } : {}),
			},
		];
	});
}

/** Maps GitHub deployment + latest status rows from `gh api` to wire shape. */
export function parseDeployments(
	deployments: unknown,
	statusesByDeploymentId: ReadonlyMap<string, unknown>,
): GithubDeploymentWire[] {
	if (!Array.isArray(deployments)) {
		return [];
	}
	return deployments.flatMap((node) => {
		if (typeof node !== 'object' || node === null) {
			return [];
		}
		const record = node as Record<string, unknown>;
		const id = String(record.id ?? '');
		if (!id) {
			return [];
		}
		const status = statusesByDeploymentId.get(id);
		const statusRecord =
			typeof status === 'object' && status !== null
				? (status as Record<string, unknown>)
				: null;
		const url =
			readString(statusRecord?.environment_url) ||
			readString(statusRecord?.target_url);
		return [
			{
				environment: readString(record.environment, 'deployment'),
				id,
				source: 'github-deployment' as const,
				state: parseDeploymentState(readString(statusRecord?.state)),
				...(url ? { url } : {}),
			},
		];
	});
}

/** Parses GraphQL review-thread nodes into resolvable review comments. */
export function parseReviewThreads(value: unknown): GithubCommentWire[] {
	if (typeof value !== 'object' || value === null) {
		return [];
	}
	const nodes = (value as { nodes?: unknown }).nodes;
	if (!Array.isArray(nodes)) {
		return [];
	}
	return nodes.flatMap((thread, threadIndex) => {
		if (typeof thread !== 'object' || thread === null) {
			return [];
		}
		const threadRecord = thread as Record<string, unknown>;
		const isResolved = threadRecord.isResolved === true;
		const commentNodes = (
			threadRecord.comments as { nodes?: unknown } | undefined
		)?.nodes;
		if (!Array.isArray(commentNodes) || commentNodes.length === 0) {
			return [];
		}
		const first = commentNodes[0];
		if (typeof first !== 'object' || first === null) {
			return [];
		}
		const comment = first as Record<string, unknown>;
		const author = (comment.author as Record<string, unknown> | undefined)
			?.login;
		return [
			{
				author: readString(author, 'unknown'),
				body: readString(comment.body),
				createdAt: readString(comment.createdAt),
				id: readString(comment.id, `thread-${threadIndex}`),
				isResolved,
				kind: 'review-comment' as const,
				...(typeof comment.line === 'number' ? { line: comment.line } : {}),
				...(readString(comment.path) ? { path: readString(comment.path) } : {}),
				...(readString(comment.url) ? { url: readString(comment.url) } : {}),
			},
		];
	});
}

function parseIssueComments(value: unknown): GithubCommentWire[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((node, index) => {
		if (typeof node !== 'object' || node === null) {
			return [];
		}
		const record = node as Record<string, unknown>;
		const author = (record.author as Record<string, unknown> | undefined)
			?.login;
		const body = readString(record.body);
		if (!body) {
			return [];
		}
		return [
			{
				author: readString(author, 'unknown'),
				body,
				createdAt: readString(record.createdAt),
				id: readString(record.id, `comment-${index}`),
				isResolved: null,
				kind: 'issue-comment' as const,
				...(readString(record.url) ? { url: readString(record.url) } : {}),
			},
		];
	});
}

function parseReviews(value: unknown): GithubCommentWire[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((node, index) => {
		if (typeof node !== 'object' || node === null) {
			return [];
		}
		const record = node as Record<string, unknown>;
		const body = readString(record.body);
		if (!body) {
			return [];
		}
		const author = (record.author as Record<string, unknown> | undefined)
			?.login;
		return [
			{
				author: readString(author, 'unknown'),
				body,
				createdAt: readString(record.submittedAt ?? record.createdAt),
				id: readString(record.id, `review-${index}`),
				isResolved: null,
				kind: 'review' as const,
				...(readString(record.url) ? { url: readString(record.url) } : {}),
			},
		];
	});
}

function bucketFromCheckRun(
	status: string,
	conclusion: string,
): GithubCheckBucket {
	const normalizedStatus = status.toUpperCase();
	if (normalizedStatus !== 'COMPLETED') {
		return 'pending';
	}
	switch (conclusion.toUpperCase()) {
		case 'SUCCESS':
		case 'NEUTRAL':
			return 'passing';
		case 'SKIPPED':
			return 'skipped';
		default:
			return 'failing';
	}
}

function bucketFromStatusContext(state: string): GithubCheckBucket {
	switch (state.toUpperCase()) {
		case 'SUCCESS':
			return 'passing';
		case 'PENDING':
		case 'EXPECTED':
			return 'pending';
		default:
			return 'failing';
	}
}

function parseDeploymentState(state: string): GithubDeploymentWire['state'] {
	switch (state.toLowerCase()) {
		case 'success':
			return 'success';
		case 'failure':
		case 'error':
			return 'failure';
		case 'inactive':
			return 'inactive';
		case 'in_progress':
		case 'queued':
		case 'pending':
			return 'pending';
		default:
			return state ? 'active' : 'pending';
	}
}

function parseMergeable(value: unknown): GithubMergeableState {
	switch (typeof value === 'string' ? value.toUpperCase() : '') {
		case 'MERGEABLE':
			return 'mergeable';
		case 'CONFLICTING':
			return 'conflicting';
		default:
			return 'unknown';
	}
}

function parseState(value: unknown): GithubPullRequestState {
	switch (typeof value === 'string' ? value.toUpperCase() : '') {
		case 'MERGED':
			return 'merged';
		case 'CLOSED':
			return 'closed';
		default:
			return 'open';
	}
}

function readString(value: unknown, fallback = ''): string {
	return typeof value === 'string' && value ? value : fallback;
}
