import type { LinearServiceFailureCode } from '../../shared/ipc/contracts/linear';
import { LinearAuthError } from './linear-auth-service.ts';

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';
const PAGE_SIZE = 50;

/** Typed error thrown by every Linear API operation. */
export class LinearServiceError extends Error {
	readonly code: LinearServiceFailureCode;
	readonly retryAfterSeconds: number | null;

	/**
	 * @param code - Machine-readable failure category.
	 * @param message - Human-readable description.
	 * @param options - Optional retry hint and cause.
	 */
	constructor(
		code: LinearServiceFailureCode,
		message: string,
		options: { cause?: unknown; retryAfterSeconds?: number | null } = {},
	) {
		super(message, { cause: options.cause });
		this.name = 'LinearServiceError';
		this.code = code;
		this.retryAfterSeconds = options.retryAfterSeconds ?? null;
	}
}

/** Flat issue payload selected from the Linear GraphQL API. */
export interface LinearIssueData {
	archivedAt: string | null;
	assignee: { id: string; name: string } | null;
	cycle: { id: string; name: string } | null;
	description: string | null;
	dueDate: string | null;
	id: string;
	labels: Array<{ color: string | null; id: string; name: string }>;
	identifier: string;
	priority: number | null;
	project: { id: string; name: string } | null;
	state: {
		color: string | null;
		id: string;
		name: string;
		type: string | null;
	} | null;
	team: { id: string; key: string; name: string } | null;
	title: string;
	updatedAt: string | null;
	url: string;
}

/** Flat comment payload selected from the Linear GraphQL API. */
export interface LinearCommentData {
	authorName: string | null;
	body: string;
	createdAt: string | null;
	id: string;
}

/** Flat metadata payload (team/project/state/label/cycle/user). */
export interface LinearResourceData {
	data: Record<string, unknown>;
	id: string;
	name: string;
	teamId: string | null;
}

/** One Relay-style page of nodes. */
export interface LinearPage<T> {
	endCursor: string | null;
	hasNextPage: boolean;
	nodes: T[];
}

/** Input for `issueCreate`. */
export interface LinearIssueCreateInput {
	assigneeId?: string;
	cycleId?: string;
	description?: string;
	dueDate?: string;
	labelIds?: string[];
	priority?: number;
	projectId?: string;
	stateId?: string;
	teamId: string;
	title: string;
}

/** Input for `issueUpdate` (all fields optional). */
export type LinearIssueUpdateInput = Partial<LinearIssueCreateInput>;

/** Filter for {@link LinearClient.listIssues}. */
export interface LinearIssueListOptions {
	after?: string | null;
	teamId?: string;
}

/** Boundary over the Linear GraphQL API with typed error mapping. */
export interface LinearClient {
	createComment: (input: {
		body: string;
		issueId: string;
	}) => Promise<LinearCommentData>;
	createIssue: (input: LinearIssueCreateInput) => Promise<LinearIssueData>;
	getIssue: (id: string) => Promise<{
		comments: LinearPage<LinearCommentData>;
		issue: LinearIssueData;
	}>;
	listMetadata: (
		kind: 'cycle' | 'label' | 'project' | 'state' | 'team' | 'user',
		after?: string | null,
	) => Promise<LinearPage<LinearResourceData>>;
	listIssues: (
		options?: LinearIssueListOptions,
	) => Promise<LinearPage<LinearIssueData>>;
	searchIssues: (term: string) => Promise<LinearPage<LinearIssueData>>;
	updateIssue: (
		id: string,
		input: LinearIssueUpdateInput,
	) => Promise<LinearIssueData>;
}

/** Options for {@link createLinearClient}. */
export interface CreateLinearClientOptions {
	apiUrl?: string;
	fetchImpl?: typeof fetch;
	getAccessToken: () => Promise<string>;
}

const ISSUE_FIELDS = `
	id
	identifier
	title
	description
	priority
	url
	dueDate
	archivedAt
	updatedAt
	team { id key name }
	project { id name }
	state { id name color type }
	assignee { id name }
	cycle { id name }
	labels(first: 50) { nodes { id name color } }
`;

const PAGE_INFO_FIELDS = 'pageInfo { hasNextPage endCursor }';

const METADATA_QUERIES = {
	cycle: `query Cycles($first: Int!, $after: String) {
		cycles(first: $first, after: $after) {
			nodes { id name number team { id } }
			${PAGE_INFO_FIELDS}
		}
	}`,
	label: `query Labels($first: Int!, $after: String) {
		issueLabels(first: $first, after: $after) {
			nodes { id name color team { id } }
			${PAGE_INFO_FIELDS}
		}
	}`,
	project: `query Projects($first: Int!, $after: String) {
		projects(first: $first, after: $after) {
			nodes { id name state }
			${PAGE_INFO_FIELDS}
		}
	}`,
	state: `query WorkflowStates($first: Int!, $after: String) {
		workflowStates(first: $first, after: $after) {
			nodes { id name color type position team { id } }
			${PAGE_INFO_FIELDS}
		}
	}`,
	team: `query Teams($first: Int!, $after: String) {
		teams(first: $first, after: $after) {
			nodes { id key name }
			${PAGE_INFO_FIELDS}
		}
	}`,
	user: `query Users($first: Int!, $after: String) {
		users(first: $first, after: $after) {
			nodes { id name displayName active }
			${PAGE_INFO_FIELDS}
		}
	}`,
} as const;

const METADATA_CONNECTION_KEYS = {
	cycle: 'cycles',
	label: 'issueLabels',
	project: 'projects',
	state: 'workflowStates',
	team: 'teams',
	user: 'users',
} as const;

/**
 * Builds the Linear GraphQL client. Direct GraphQL is used instead of
 * `@linear/sdk` because cache sync needs flat field selections in a single
 * request per page; the SDK lazily resolves relations, which would fan out
 * into N+1 requests (see `docs/product/linear-api-discovery.md`).
 * @param options - Token source and optional fetch/api overrides.
 * @returns A fresh {@link LinearClient}.
 */
export function createLinearClient({
	apiUrl = LINEAR_GRAPHQL_URL,
	fetchImpl = fetch,
	getAccessToken,
}: CreateLinearClientOptions): LinearClient {
	async function execute<T>(
		query: string,
		variables: Record<string, unknown>,
	): Promise<T> {
		const accessToken = await getAccessToken().catch((error) => {
			throw mapAuthError(error);
		});

		let response: Response;

		try {
			response = await fetchImpl(apiUrl, {
				body: JSON.stringify({ query, variables }),
				headers: {
					authorization: `Bearer ${accessToken}`,
					'content-type': 'application/json',
				},
				method: 'POST',
			});
		} catch (error) {
			throw new LinearServiceError(
				'network',
				'Could not reach the Linear API.',
				{ cause: error },
			);
		}

		if (response.status === 401) {
			throw new LinearServiceError(
				'reconnect-required',
				'Linear rejected the stored token. Reconnect Linear from settings.',
			);
		}

		if (response.status === 429) {
			throw new LinearServiceError(
				'rate-limited',
				'The Linear API rate limit was reached.',
				{ retryAfterSeconds: parseRetryAfter(response) },
			);
		}

		// Linear reports GraphQL errors (including RATELIMITED) as HTTP 400, so
		// the body must be parsed before the status code is acted on.
		const payload = (await response.json().catch(() => null)) as {
			data?: T;
			errors?: Array<{
				extensions?: { code?: string; retryAfter?: number; type?: string };
				message?: string;
			}>;
		} | null;

		if (payload?.errors && payload.errors.length > 0) {
			throw mapGraphqlErrors(payload.errors);
		}

		if (!response.ok) {
			throw new LinearServiceError(
				'network',
				`The Linear API responded with HTTP ${response.status}.`,
			);
		}

		if (!payload?.data) {
			throw new LinearServiceError(
				'network',
				'The Linear API returned an empty response.',
			);
		}

		return payload.data;
	}

	async function fetchIssuePage(
		query: string,
		variables: Record<string, unknown>,
		connectionKey: 'issues' | 'searchIssues',
	): Promise<LinearPage<LinearIssueData>> {
		const data = await execute<Record<string, ConnectionPayload<IssueNode>>>(
			query,
			variables,
		);
		const connection = data[connectionKey];

		if (!connection) {
			throw new LinearServiceError(
				'network',
				`The Linear API response did not include "${connectionKey}".`,
			);
		}

		return {
			endCursor: connection.pageInfo.endCursor ?? null,
			hasNextPage: connection.pageInfo.hasNextPage,
			nodes: connection.nodes.map(mapIssueNode),
		};
	}

	return {
		createComment: async ({ body, issueId }) => {
			const data = await execute<{
				commentCreate: {
					comment: CommentNode | null;
					success: boolean;
				};
			}>(
				`mutation CommentCreate($input: CommentCreateInput!) {
					commentCreate(input: $input) {
						success
						comment { id body createdAt user { name displayName } }
					}
				}`,
				{ input: { body, issueId } },
			);

			if (!data.commentCreate.success || !data.commentCreate.comment) {
				throw new LinearServiceError(
					'invalid-request',
					'Linear did not accept the comment.',
				);
			}

			return mapCommentNode(data.commentCreate.comment);
		},

		createIssue: async (input) => {
			const data = await execute<{
				issueCreate: { issue: IssueNode | null; success: boolean };
			}>(
				`mutation IssueCreate($input: IssueCreateInput!) {
					issueCreate(input: $input) {
						success
						issue { ${ISSUE_FIELDS} }
					}
				}`,
				{ input },
			);

			if (!data.issueCreate.success || !data.issueCreate.issue) {
				throw new LinearServiceError(
					'invalid-request',
					'Linear did not accept the new issue.',
				);
			}

			return mapIssueNode(data.issueCreate.issue);
		},

		getIssue: async (id) => {
			const data = await execute<{
				issue:
					| (IssueNode & { comments: ConnectionPayload<CommentNode> })
					| null;
			}>(
				`query Issue($id: String!, $first: Int!) {
					issue(id: $id) {
						${ISSUE_FIELDS}
						comments(first: $first) {
							nodes { id body createdAt user { name displayName } }
							${PAGE_INFO_FIELDS}
						}
					}
				}`,
				{ first: PAGE_SIZE, id },
			);

			if (!data.issue) {
				throw new LinearServiceError(
					'not-found',
					`Linear issue "${id}" was not found.`,
				);
			}

			return {
				comments: {
					endCursor: data.issue.comments.pageInfo.endCursor ?? null,
					hasNextPage: data.issue.comments.pageInfo.hasNextPage,
					nodes: data.issue.comments.nodes.map(mapCommentNode),
				},
				issue: mapIssueNode(data.issue),
			};
		},

		listIssues: async ({ after = null, teamId } = {}) => {
			return fetchIssuePage(
				`query Issues($first: Int!, $after: String, $filter: IssueFilter) {
					issues(first: $first, after: $after, filter: $filter) {
						nodes { ${ISSUE_FIELDS} }
						${PAGE_INFO_FIELDS}
					}
				}`,
				{
					after,
					filter: teamId ? { team: { id: { eq: teamId } } } : null,
					first: PAGE_SIZE,
				},
				'issues',
			);
		},

		listMetadata: async (kind, after = null) => {
			const data = await execute<
				Record<string, ConnectionPayload<MetadataNode>>
			>(METADATA_QUERIES[kind], { after, first: PAGE_SIZE });
			const connection = data[METADATA_CONNECTION_KEYS[kind]];

			if (!connection) {
				throw new LinearServiceError(
					'network',
					`The Linear API response did not include "${METADATA_CONNECTION_KEYS[kind]}".`,
				);
			}

			return {
				endCursor: connection.pageInfo.endCursor ?? null,
				hasNextPage: connection.pageInfo.hasNextPage,
				nodes: connection.nodes.map(mapMetadataNode),
			};
		},

		searchIssues: async (term) => {
			return fetchIssuePage(
				`query SearchIssues($term: String!, $first: Int!) {
					searchIssues(term: $term, first: $first) {
						nodes { ${ISSUE_FIELDS} }
						${PAGE_INFO_FIELDS}
					}
				}`,
				{ first: PAGE_SIZE, term },
				'searchIssues',
			);
		},

		updateIssue: async (id, input) => {
			const data = await execute<{
				issueUpdate: { issue: IssueNode | null; success: boolean };
			}>(
				`mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
					issueUpdate(id: $id, input: $input) {
						success
						issue { ${ISSUE_FIELDS} }
					}
				}`,
				{ id, input },
			);

			if (!data.issueUpdate.success || !data.issueUpdate.issue) {
				throw new LinearServiceError(
					'invalid-request',
					'Linear did not accept the issue update.',
				);
			}

			return mapIssueNode(data.issueUpdate.issue);
		},
	};
}

interface ConnectionPayload<T> {
	nodes: T[];
	pageInfo: { endCursor?: string | null; hasNextPage: boolean };
}

interface IssueNode {
	archivedAt?: string | null;
	assignee?: { id: string; name: string } | null;
	cycle?: { id: string; name: string } | null;
	description?: string | null;
	dueDate?: string | null;
	id: string;
	labels?: {
		nodes: Array<{ color?: string | null; id: string; name: string }>;
	} | null;
	identifier: string;
	priority?: number | null;
	project?: { id: string; name: string } | null;
	state?: {
		color?: string | null;
		id: string;
		name: string;
		type?: string | null;
	} | null;
	team?: { id: string; key: string; name: string } | null;
	title: string;
	updatedAt?: string | null;
	url: string;
}

interface CommentNode {
	body: string;
	createdAt?: string | null;
	id: string;
	user?: { displayName?: string | null; name?: string | null } | null;
}

interface MetadataNode {
	id: string;
	name?: string | null;
	team?: { id: string } | null;
	[key: string]: unknown;
}

function mapIssueNode(node: IssueNode): LinearIssueData {
	return {
		archivedAt: node.archivedAt ?? null,
		assignee: node.assignee ?? null,
		cycle: node.cycle ?? null,
		description: node.description ?? null,
		dueDate: node.dueDate ?? null,
		id: node.id,
		labels: (node.labels?.nodes ?? []).map((label) => ({
			color: label.color ?? null,
			id: label.id,
			name: label.name,
		})),
		identifier: node.identifier,
		priority: node.priority ?? null,
		project: node.project ?? null,
		state: node.state
			? {
					color: node.state.color ?? null,
					id: node.state.id,
					name: node.state.name,
					type: node.state.type ?? null,
				}
			: null,
		team: node.team ?? null,
		title: node.title,
		updatedAt: node.updatedAt ?? null,
		url: node.url,
	};
}

function mapCommentNode(node: CommentNode): LinearCommentData {
	return {
		authorName: node.user?.displayName ?? node.user?.name ?? null,
		body: node.body,
		createdAt: node.createdAt ?? null,
		id: node.id,
	};
}

function mapMetadataNode(node: MetadataNode): LinearResourceData {
	const { team, ...data } = node;

	return {
		data,
		id: node.id,
		name: typeof node.name === 'string' ? node.name : node.id,
		teamId: team?.id ?? null,
	};
}

function mapAuthError(error: unknown): LinearServiceError {
	if (error instanceof LinearAuthError) {
		if (error.code === 'not-connected' || error.code === 'not-configured') {
			return new LinearServiceError('not-connected', error.message, {
				cause: error,
			});
		}

		return new LinearServiceError('reconnect-required', error.message, {
			cause: error,
		});
	}

	return new LinearServiceError(
		'reconnect-required',
		'Resolving the Linear access token failed.',
		{ cause: error },
	);
}

function mapGraphqlErrors(
	errors: Array<{
		extensions?: { code?: string; retryAfter?: number; type?: string };
		message?: string;
	}>,
): LinearServiceError {
	const message =
		errors[0]?.message ?? 'The Linear API returned an unknown error.';
	const markers = errors
		.flatMap((error) => [error.extensions?.code, error.extensions?.type])
		.filter((value): value is string => typeof value === 'string')
		.map((value) => value.toUpperCase());

	if (markers.some((marker) => marker.includes('RATELIMIT'))) {
		return new LinearServiceError('rate-limited', message, {
			retryAfterSeconds: errors[0]?.extensions?.retryAfter ?? null,
		});
	}

	if (
		markers.some(
			(marker) =>
				marker.includes('AUTHENTICATION') || marker.includes('UNAUTHENTICATED'),
		)
	) {
		return new LinearServiceError('reconnect-required', message);
	}

	if (markers.some((marker) => marker.includes('FORBIDDEN'))) {
		return new LinearServiceError('permission-denied', message);
	}

	if (/not found|could not be found/i.test(message)) {
		return new LinearServiceError('not-found', message);
	}

	return new LinearServiceError('invalid-request', message);
}

function parseRetryAfter(response: Response): number | null {
	const header = response.headers.get('retry-after');

	if (!header) {
		return null;
	}

	const seconds = Number.parseInt(header, 10);

	return Number.isNaN(seconds) ? null : seconds;
}
