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
	| 'login-canceled'
	| 'login-in-progress'
	| 'network-error'
	| 'not-configured'
	| 'not-connected'
	| 'refresh-failed'
	| 'secret-store-error'
	| 'state-mismatch';

/** Non-secret snapshot of the Linear connection shown in setup and settings. */
export interface LinearConnectionSnapshot {
	expiresAt: string | null;
	organizationName: string | null;
	organizationUrlKey: string | null;
	scopes: string[];
	state: LinearConnectionState;
	updatedAt: string | null;
	userEmail: string | null;
	userName: string | null;
}

/** Typed failure envelope returned by Linear auth IPC calls. */
export interface LinearAuthFailure {
	code: LinearAuthFailureCode;
	message: string;
}

/** Result of an interactive Linear OAuth login attempt. */
export type LinearLoginResult =
	| { snapshot: LinearConnectionSnapshot; status: 'connected' }
	| { failure: LinearAuthFailure; status: 'error' };

/** Result of disconnecting the Linear integration. */
export type LinearDisconnectResult =
	| { snapshot: LinearConnectionSnapshot; status: 'disconnected' }
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

/** Wire shape of a Linear issue label. */
export interface LinearIssueLabelWire {
	color: string | null;
	id: string;
	name: string;
}

/** Wire shape of a cached Linear issue. */
export interface LinearIssueWire {
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
	color: string | null;
	id: string;
	key: string | null;
	kind: LinearResourceKindWire;
	name: string;
	teamId: string | null;
	type: string | null;
}

/** Cached Linear metadata grouped by kind. */
export interface LinearMetadataWire {
	cycles: LinearResourceWire[];
	labels: LinearResourceWire[];
	projects: LinearResourceWire[];
	states: LinearResourceWire[];
	syncedAt: string | null;
	teams: LinearResourceWire[];
	users: LinearResourceWire[];
}

/** Request for {@link LinearApi.linearListIssues}. */
export interface ListLinearIssuesRequest {
	query?: string;
	refresh?: boolean;
	teamId?: string;
}

/** Result of listing/searching Linear issues (cache-first, degradable). */
export type ListLinearIssuesResult =
	| { issues: LinearIssueWire[]; source: 'cache' | 'remote'; status: 'ok' }
	| {
			failure: LinearServiceFailure;
			issues: LinearIssueWire[];
			status: 'error';
	  };

/** Request for {@link LinearApi.linearGetIssue}. */
export interface GetLinearIssueRequest {
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
	refresh?: boolean;
}

/** Result of reading cached Linear metadata. */
export type GetLinearMetadataResult =
	| { metadata: LinearMetadataWire; status: 'ok' }
	| {
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

/** Request for {@link LinearApi.linearCreateIssue}. */
export interface CreateLinearIssueRequest extends LinearIssueFieldsInput {
	teamId: string;
	title: string;
}

/** Request for {@link LinearApi.linearUpdateIssue}. */
export interface UpdateLinearIssueRequest {
	id: string;
	input: LinearIssueFieldsInput & { teamId?: string; title?: string };
}

/** Result of a Linear issue create/update mutation. */
export type MutateLinearIssueResult =
	| { issue: LinearIssueWire; status: 'ok' }
	| { failure: LinearServiceFailure; status: 'error' };

/** Request for {@link LinearApi.linearCreateComment}. */
export interface CreateLinearCommentRequest {
	body: string;
	issueId: string;
}

/** Result of creating a Linear comment. */
export type CreateLinearCommentResult =
	| { comment: LinearCommentWire; status: 'ok' }
	| { failure: LinearServiceFailure; status: 'error' };

/** Linear integration IPC surface (OAuth lifecycle + issue data). */
export interface LinearApi {
	linearCancelLogin: () => Promise<void>;
	linearConnectionStatus: () => Promise<LinearConnectionSnapshot>;
	linearCreateComment: (
		request: CreateLinearCommentRequest,
	) => Promise<CreateLinearCommentResult>;
	linearCreateIssue: (
		request: CreateLinearIssueRequest,
	) => Promise<MutateLinearIssueResult>;
	linearDisconnect: () => Promise<LinearDisconnectResult>;
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
