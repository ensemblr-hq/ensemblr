import type {
	GithubCheckBucket,
	GithubCheckWire,
	GithubCommentWire,
	GithubDeploymentWire,
	GithubMergeableState,
	GithubPullRequestState,
	GithubPullRequestWire,
} from '../../shared/ipc/contracts/github';

/** JSON fields requested from `gh pr view --json`. */
export const PR_VIEW_JSON_FIELDS = [
	'additions',
	'baseRefName',
	'body',
	'comments',
	'deletions',
	'headRefName',
	'headRefOid',
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
		headRefOid: readString(raw.headRefOid),
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

/**
 * Whether a GraphQL author node is a GitHub App/bot, used to badge Actions-bot
 * review comments. Detects both the `Bot` GraphQL typename and the `[bot]`
 * login suffix GitHub appends to app identities.
 * @param author - The GraphQL `author` record, if present
 * @returns True when the author is a bot
 */
function isBotAuthor(author: Record<string, unknown> | undefined): boolean {
	if (!author) {
		return false;
	}
	if (author.__typename === 'Bot') {
		return true;
	}
	return readString(author.login).endsWith('[bot]');
}

/**
 * Read the diff side of a review thread, normalizing to the wire `LEFT`/`RIGHT`
 * union used to anchor a comment to the old or new side of the diff.
 * @param value - The GraphQL `diffSide` value
 * @returns The normalized side, or undefined when absent/unknown
 */
function readDiffSide(value: unknown): 'LEFT' | 'RIGHT' | undefined {
	return value === 'LEFT' || value === 'RIGHT' ? value : undefined;
}

/**
 * Map one review-thread comment node to a wire comment, tagging bot authors.
 * @param node - The GraphQL comment node
 * @param index - Position within the thread, for a stable id fallback
 * @returns The wire comment, or null when the node is malformed
 */
function parseThreadComment(
	node: unknown,
	index: number,
): GithubCommentWire | null {
	if (typeof node !== 'object' || node === null) {
		return null;
	}
	const record = node as Record<string, unknown>;
	const author = record.author as Record<string, unknown> | undefined;
	return {
		author: readString(author?.login, 'unknown'),
		body: readString(record.body),
		createdAt: readString(record.createdAt),
		id: readString(record.id, `comment-${index}`),
		isBot: isBotAuthor(author),
		isResolved: null,
		kind: 'review-comment' as const,
		...(readString(record.url) ? { url: readString(record.url) } : {}),
	};
}

/**
 * Parse GraphQL review-thread nodes into anchored review comments. Each thread
 * yields one head comment carrying its diff anchor (path/line/side), resolution
 * and outdated state, a bot flag, and its replies.
 * @param value - The GraphQL `reviewThreads` connection
 * @returns The parsed review-thread comments in wire form
 */
export function parseReviewThreads(value: unknown): GithubCommentWire[] {
	if (typeof value !== 'object' || value === null) {
		return [];
	}
	const nodes = (value as { nodes?: unknown }).nodes;
	if (!Array.isArray(nodes)) {
		return [];
	}
	return nodes.flatMap((thread) => {
		if (typeof thread !== 'object' || thread === null) {
			return [];
		}
		const threadRecord = thread as Record<string, unknown>;
		const commentNodes = (
			threadRecord.comments as { nodes?: unknown } | undefined
		)?.nodes;
		if (!Array.isArray(commentNodes) || commentNodes.length === 0) {
			return [];
		}
		const head = parseThreadComment(commentNodes[0], 0);
		if (!head) {
			return [];
		}
		const replies = commentNodes
			.slice(1)
			.map((node, index) => parseThreadComment(node, index + 1))
			.filter((comment): comment is GithubCommentWire => comment !== null);
		const side = readDiffSide(threadRecord.diffSide);
		return [
			{
				...head,
				isOutdated: threadRecord.isOutdated === true,
				isResolved: threadRecord.isResolved === true,
				...(replies.length > 0 ? { replies } : {}),
				...(readString(threadRecord.id)
					? { threadId: readString(threadRecord.id) }
					: {}),
				...(typeof threadRecord.line === 'number'
					? { line: threadRecord.line }
					: {}),
				...(readString(threadRecord.path)
					? { path: readString(threadRecord.path) }
					: {}),
				...(side ? { side } : {}),
				...(typeof threadRecord.startLine === 'number'
					? { startLine: threadRecord.startLine }
					: {}),
			},
		];
	});
}

/**
 * Parse GraphQL issue-comment nodes into wire comments, dropping ones without a body.
 * @param value - Raw issue-comment nodes from the gh GraphQL response
 * @returns The parsed issue comments in wire form
 */
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

/**
 * Parse GraphQL review nodes into wire comments, dropping reviews without a body.
 * @param value - Raw review nodes from the gh GraphQL response
 * @returns The parsed reviews in wire comment form
 */
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

/**
 * Reduce a check run's status and conclusion to a single check bucket.
 * @param status - Check run status (e.g. `COMPLETED`)
 * @param conclusion - Check run conclusion (e.g. `SUCCESS`)
 * @returns The bucket the check run belongs to
 */
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

/**
 * Reduce a legacy commit-status context state to a check bucket.
 * @param state - Commit-status state (e.g. `SUCCESS`, `PENDING`)
 * @returns The bucket the status context belongs to
 */
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

/**
 * Normalize a raw deployment state string into the wire deployment state.
 * @param state - Raw deployment state from GitHub
 * @returns The corresponding wire deployment state
 */
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

/**
 * Normalize a raw mergeable value into the mergeable state, defaulting to unknown.
 * @param value - Raw mergeable value from GitHub
 * @returns The parsed mergeable state
 */
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

/**
 * Normalize a raw pull-request state value into the wire PR state, defaulting to open.
 * @param value - Raw PR state value from GitHub
 * @returns The parsed pull-request state
 */
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

/**
 * Coerce an unknown value to a non-empty string, otherwise return the fallback.
 * @param value - Value to read as a string
 * @param fallback - Value returned when `value` is not a non-empty string
 * @returns The string value or the fallback
 */
function readString(value: unknown, fallback = ''): string {
	return typeof value === 'string' && value ? value : fallback;
}
