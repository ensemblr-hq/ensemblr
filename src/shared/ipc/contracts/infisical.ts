/** Scope an Infisical link is attached to: a repository or a single workspace. */
export type InfisicalLinkScope = 'repository' | 'workspace';

/** Machine-readable failure categories surfaced by every Infisical operation. */
export type InfisicalFailureCode =
	| 'database-unavailable'
	| 'infisical-account-exists'
	| 'infisical-account-not-found'
	| 'infisical-invalid-credentials'
	| 'infisical-invalid-request'
	| 'infisical-network'
	| 'infisical-not-linked'
	| 'infisical-permission-denied'
	| 'infisical-project-not-found'
	| 'infisical-rate-limited'
	| 'infisical-secret-store-unavailable'
	| 'infisical-server-error'
	| 'infisical-unknown';

/**
 * Typed failure envelope. `code` drives the localized renderer copy; `message`
 * is the English diagnostic kept for the support bundle and logs.
 */
export interface InfisicalFailure {
	code: InfisicalFailureCode;
	message: string;
	retryAfterSeconds: number | null;
}

/**
 * Non-secret view of one configured Infisical account. The client secret lives
 * in the Keychain and is never returned; only its mask crosses the bridge.
 */
export interface InfisicalAccountSnapshot {
	clientId: string;
	createdAt: string;
	id: string;
	label: string;
	lastErrorCode: InfisicalFailureCode | null;
	lastVerifiedAt: string | null;
	maskedClientSecret: string | null;
	siteUrl: string;
	updatedAt: string;
}

/** One environment of an Infisical project, as shown in the environment picker. */
export interface InfisicalEnvironmentSnapshot {
	name: string;
	slug: string;
}

/**
 * One Infisical project the authenticated identity can reach, with its
 * environments and the account that reached it. Projects are listed across
 * every configured account at once, so each one carries its own origin.
 */
export interface InfisicalProjectSnapshot {
	accountId: string;
	accountLabel: string;
	environments: InfisicalEnvironmentSnapshot[];
	id: string;
	name: string;
	slug: string | null;
}

/**
 * A resolved link between an Ensemblr scope and an Infisical project.
 * `fromRepositoryConfig` marks the project half as coming from the committed
 * `.ensemblr/settings.toml` rather than from local state.
 */
export interface InfisicalLinkSnapshot {
	accountId: string | null;
	accountLabel: string | null;
	enabled: boolean;
	environmentSlug: string;
	fromRepositoryConfig: boolean;
	lastSyncedAt: string | null;
	projectId: string;
	projectName: string | null;
	recursive: boolean;
	scope: InfisicalLinkScope;
	scopeId: string;
	secretPath: string;
	siteUrl: string | null;
}

/** Request naming a single account by id. */
export interface InfisicalAccountRequest {
	accountId: string;
}

/** Request to add an account. The client secret is write-only and never read back. */
export interface AddInfisicalAccountRequest {
	clientId: string;
	clientSecret: string;
	label: string;
	siteUrl: string;
}

/** Request naming the Ensemblr scope whose link is being read or cleared. */
export interface InfisicalLinkScopeRequest {
	scope: InfisicalLinkScope;
	scopeId: string;
}

/** Request to create or replace the link attached to one scope. */
export interface SetInfisicalLinkRequest extends InfisicalLinkScopeRequest {
	accountId: string;
	enabled?: boolean;
	environmentSlug: string;
	projectId: string;
	projectName?: string;
	recursive?: boolean;
	secretPath?: string;
}

/** Every configured account, plus a failure when the list could not be read. */
export interface InfisicalAccountsResult {
	accounts: InfisicalAccountSnapshot[];
	failure: InfisicalFailure | null;
}

/** Outcome of an account write or connectivity test. */
export interface InfisicalAccountMutationResult {
	account: InfisicalAccountSnapshot | null;
	failure: InfisicalFailure | null;
}

/** One account whose projects could not be listed, inside an otherwise usable list. */
export interface InfisicalAccountListFailure {
	accountId: string;
	accountLabel: string;
	failure: InfisicalFailure;
}

/**
 * Every project reachable across every configured account. `failure` is set
 * only when nothing at all could be listed; `accountFailures` carries the
 * accounts that dropped out of an otherwise usable list.
 */
export interface InfisicalProjectsResult {
	accountFailures: InfisicalAccountListFailure[];
	failure: InfisicalFailure | null;
	projects: InfisicalProjectSnapshot[];
}

/** The link attached to a scope (`null` when the scope is not linked). */
export interface InfisicalLinkResult {
	failure: InfisicalFailure | null;
	link: InfisicalLinkSnapshot | null;
}

/**
 * Outcome of a manual sync. `keys` carries variable names only — resolved
 * values never cross the bridge.
 */
export interface InfisicalSyncResult {
	failure: InfisicalFailure | null;
	keys: string[];
	syncedAt: string | null;
}

/** Infisical account, project-link, and sync IPC surface. */
export interface InfisicalApi {
	infisicalAccounts: () => Promise<InfisicalAccountsResult>;
	infisicalAddAccount: (
		request: AddInfisicalAccountRequest,
	) => Promise<InfisicalAccountMutationResult>;
	infisicalClearLink: (
		request: InfisicalLinkScopeRequest,
	) => Promise<InfisicalLinkResult>;
	infisicalLink: (
		request: InfisicalLinkScopeRequest,
	) => Promise<InfisicalLinkResult>;
	infisicalProjects: () => Promise<InfisicalProjectsResult>;
	infisicalRemoveAccount: (
		request: InfisicalAccountRequest,
	) => Promise<InfisicalAccountMutationResult>;
	infisicalSetLink: (
		request: SetInfisicalLinkRequest,
	) => Promise<InfisicalLinkResult>;
	infisicalSync: (
		request: InfisicalLinkScopeRequest,
	) => Promise<InfisicalSyncResult>;
	infisicalTestAccount: (
		request: InfisicalAccountRequest,
	) => Promise<InfisicalAccountMutationResult>;
}
