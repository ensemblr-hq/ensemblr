/** Connection lifecycle states for the Linear OAuth integration. */
export type LinearConnectionState =
	| 'connected'
	| 'disconnected'
	| 'not-configured'
	| 'reconnect-required';

/** Machine-readable failure categories surfaced by Linear auth operations. */
export type LinearAuthFailureCode =
	| 'callback-failed'
	| 'callback-timeout'
	| 'database-error'
	| 'exchange-failed'
	| 'linear-unknown'
	| 'login-canceled'
	| 'login-in-progress'
	| 'network-error'
	| 'not-configured'
	| 'not-connected'
	| 'refresh-failed'
	| 'secret-store-error'
	| 'state-mismatch';

/** Non-secret snapshot of one connected Linear account. */
export interface LinearAccountSnapshot {
	expiresAt: string | null;
	id: string;
	lastErrorCode: LinearAuthFailureCode | null;
	organizationId: string;
	organizationName: string | null;
	organizationUrlKey: string | null;
	scopes: string[];
	state: LinearConnectionState;
	updatedAt: string | null;
	userEmail: string | null;
	userId: string;
	userName: string | null;
}

/**
 * Every connected account plus one aggregate state. The setup check and the
 * onboarding gate ask a single yes/no question about Linear, so the summary
 * answers it without either surface having to reduce the list itself.
 */
export interface LinearConnectionSummary {
	accounts: LinearAccountSnapshot[];
	state: LinearConnectionState;
}

/** Typed failure envelope returned by Linear auth IPC calls. */
export interface LinearAuthFailure {
	code: LinearAuthFailureCode;
	message: string;
}

/** Result of an interactive Linear OAuth login attempt. */
export type LinearLoginResult =
	| { account: LinearAccountSnapshot; status: 'connected' }
	| { failure: LinearAuthFailure; status: 'error' };

/** Request for {@link LinearApi.linearDisconnect}. */
export interface LinearDisconnectRequest {
	accountId: string;
}

/** Result of disconnecting one Linear account. */
export type LinearDisconnectResult =
	| { status: 'disconnected'; summary: LinearConnectionSummary }
	| { failure: LinearAuthFailure; status: 'error' };

/** Machine-readable failure categories for Linear data operations. */
export type LinearServiceFailureCode =
	| 'invalid-request'
	| 'network'
	| 'not-connected'
	| 'not-found'
	| 'permission-denied'
	| 'rate-limited'
	| 'reconnect-required';

/** Typed failure envelope for Linear data operations. */
export interface LinearServiceFailure {
	code: LinearServiceFailureCode;
	message: string;
	retryAfterSeconds: number | null;
}

/**
 * One account's failure inside a result that still carries the other accounts'
 * data. A rate-limited or reauthorizing account must narrow a merged list, not
 * blank it.
 */
export interface LinearAccountFailure {
	accountId: string;
	failure: LinearServiceFailure;
	organizationName: string | null;
}

/** Wire shape of a Linear issue label. */
export interface LinearIssueLabelWire {
	color: string | null;
	id: string;
	name: string;
}

/** Wire shape of a cached Linear issue. */
export interface LinearIssueWire {
	accountId: string;
	archivedAt: string | null;
	assigneeId: string | null;
	assigneeName: string | null;
	cycleId: string | null;
	cycleName: string | null;
	description: string | null;
	dueDate: string | null;
	labels: LinearIssueLabelWire[];
	id: string;
	identifier: string;
	/** Owning account's Linear organization, so a row badges itself without a second lookup. */
	organizationName: string | null;
	priority: number | null;
	projectId: string | null;
	projectName: string | null;
	stateColor: string | null;
	stateId: string | null;
	stateName: string | null;
	stateType: string | null;
	syncedAt: string | null;
	teamId: string | null;
	teamKey: string | null;
	teamName: string | null;
	title: string;
	updatedAt: string | null;
	url: string;
}

/** Wire shape of a Linear issue comment. */
export interface LinearCommentWire {
	authorName: string | null;
	body: string;
	createdAt: string | null;
	id: string;
}

/** Kinds of cached Linear metadata resources. */
export type LinearResourceKindWire =
	| 'cycle'
	| 'label'
	| 'project'
	| 'state'
	| 'team'
	| 'user';

/** Wire shape of a Linear metadata resource (team, project, state, …). */
export interface LinearResourceWire {
	accountId: string;
	color: string | null;
	id: string;
	/** Short identifier: a team's key, or a cycle's number as a string. */
	key: string | null;
	kind: LinearResourceKindWire;
	/** Empty for a cycle Linear never named; the renderer labels it from `key`. */
	name: string;
	/** Owning account's Linear organization, so a picker can group by org. */
	organizationName: string | null;
	teamId: string | null;
	type: string | null;
}

/** Cached Linear metadata grouped by kind, merged across every account. */
export interface LinearMetadataWire {
	cycles: LinearResourceWire[];
	labels: LinearResourceWire[];
	projects: LinearResourceWire[];
	states: LinearResourceWire[];
	syncedAt: string | null;
	teams: LinearResourceWire[];
	users: LinearResourceWire[];
}

/**
 * Request for {@link LinearApi.linearListIssues}. Omitting `accountId` merges
 * every connected account; naming one narrows the read to it.
 */
export interface ListLinearIssuesRequest {
	accountId?: string;
	query?: string;
	refresh?: boolean;
	teamId?: string;
}

/**
 * Result of listing/searching Linear issues (cache-first, degradable).
 * `syncing` marks a cached answer served ahead of a refresh that is still
 * running, so the caller can poll for the newer rows rather than block on them.
 */
export type ListLinearIssuesResult =
	| {
			accountFailures: LinearAccountFailure[];
			issues: LinearIssueWire[];
			source: 'cache' | 'remote';
			status: 'ok';
			syncing?: boolean;
	  }
	| {
			accountFailures: LinearAccountFailure[];
			failure: LinearServiceFailure;
			issues: LinearIssueWire[];
			status: 'error';
	  };

/**
 * Request for {@link LinearApi.linearGetIssue}. `accountId` is optional because
 * a cached issue already names its account; supply it to read an issue the cache
 * has never seen.
 */
export interface GetLinearIssueRequest {
	accountId?: string;
	fallbackAccountId?: string;
	id: string;
	refresh?: boolean;
}

/** Result of reading one Linear issue with comments. */
export type GetLinearIssueResult =
	| {
			comments: LinearCommentWire[];
			issue: LinearIssueWire;
			source: 'cache' | 'remote';
			status: 'ok';
	  }
	| { failure: LinearServiceFailure; status: 'error' };

/** Request for {@link LinearApi.linearMetadata}. */
export interface GetLinearMetadataRequest {
	accountId?: string;
	refresh?: boolean;
}

/**
 * Result of reading cached Linear metadata. `syncing` marks a cached answer
 * served ahead of a refresh that is still running.
 */
export type GetLinearMetadataResult =
	| {
			accountFailures: LinearAccountFailure[];
			metadata: LinearMetadataWire;
			status: 'ok';
			syncing?: boolean;
	  }
	| {
			accountFailures: LinearAccountFailure[];
			failure: LinearServiceFailure;
			metadata: LinearMetadataWire;
			status: 'error';
	  };

/** Issue fields accepted by Linear create/update mutations. */
export interface LinearIssueFieldsInput {
	assigneeId?: string;
	cycleId?: string;
	description?: string;
	dueDate?: string;
	labelIds?: string[];
	priority?: number;
	projectId?: string;
	stateId?: string;
}

/**
 * Request for {@link LinearApi.linearCreateIssue}. `accountId` is optional
 * because the target team already belongs to exactly one account.
 */
export interface CreateLinearIssueRequest extends LinearIssueFieldsInput {
	accountId?: string;
	fallbackAccountId?: string;
	teamId: string;
	title: string;
}

/**
 * Fields an update may change. `dueDate` widens to `null` because clearing a
 * date is a distinct intent from leaving it alone, which an absent key means.
 */
export type LinearIssueUpdateFieldsInput = Omit<
	LinearIssueFieldsInput,
	'dueDate'
> & {
	dueDate?: string | null;
	teamId?: string;
	title?: string;
};

/** Request for {@link LinearApi.linearUpdateIssue}. */
export interface UpdateLinearIssueRequest {
	accountId?: string;
	fallbackAccountId?: string;
	id: string;
	input: LinearIssueUpdateFieldsInput;
}

/** Result of a Linear issue create/update mutation. */
export type MutateLinearIssueResult =
	| { issue: LinearIssueWire; status: 'ok' }
	| { failure: LinearServiceFailure; status: 'error' };

/** Request for {@link LinearApi.linearCreateComment}. */
export interface CreateLinearCommentRequest {
	accountId?: string;
	body: string;
	fallbackAccountId?: string;
	issueId: string;
}

/** Result of creating a Linear comment. */
export type CreateLinearCommentResult =
	| { comment: LinearCommentWire; status: 'ok' }
	| { failure: LinearServiceFailure; status: 'error' };

/** Linear integration IPC surface (OAuth lifecycle + issue data). */
export interface LinearApi {
	linearCancelLogin: () => Promise<void>;
	linearConnectionStatus: () => Promise<LinearConnectionSummary>;
	linearCreateComment: (
		request: CreateLinearCommentRequest,
	) => Promise<CreateLinearCommentResult>;
	linearCreateIssue: (
		request: CreateLinearIssueRequest,
	) => Promise<MutateLinearIssueResult>;
	linearDisconnect: (
		request: LinearDisconnectRequest,
	) => Promise<LinearDisconnectResult>;
	linearGetIssue: (
		request: GetLinearIssueRequest,
	) => Promise<GetLinearIssueResult>;
	linearListIssues: (
		request: ListLinearIssuesRequest | undefined,
	) => Promise<ListLinearIssuesResult>;
	linearMetadata: (
		request: GetLinearMetadataRequest | undefined,
	) => Promise<GetLinearMetadataResult>;
	linearStartLogin: () => Promise<LinearLoginResult>;
	linearUpdateIssue: (
		request: UpdateLinearIssueRequest,
	) => Promise<MutateLinearIssueResult>;
}
