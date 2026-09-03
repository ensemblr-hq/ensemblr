import type { RegisteredRepositorySnapshot } from './repository';

/** Machine-readable codes for failures and warnings raised while scaffolding a quick-start project. */
export type QuickStartProjectDiagnosticCode =
	| 'destination-exists'
	| 'destination-not-writable'
	| 'destination-path-relative'
	| 'destination-required'
	| 'git-init-failed'
	| 'git-not-installed'
	| 'mkdir-failed'
	| 'name-already-in-use'
	| 'name-invalid'
	| 'name-required'
	| 'owner-invalid'
	| 'publish-failed'
	| 'register-failed';

/** Severity level of a quick-start project diagnostic. */
export type QuickStartProjectDiagnosticSeverity = 'error' | 'info' | 'warning';

/** A single diagnostic emitted while scaffolding a quick-start project. */
export interface QuickStartProjectDiagnostic {
	code: QuickStartProjectDiagnosticCode;
	message: string;
	path?: string;
	severity: QuickStartProjectDiagnosticSeverity;
}

/** Request to scaffold a new quick-start project. */
export interface QuickStartProjectRequest {
	name: string;
	owner?: string;
	parentPath?: string;
}

/** Outcome status of a quick-start project scaffolding attempt. */
export type QuickStartProjectStatus = 'failure' | 'success';

/** Result of a quick-start scaffolding attempt, with diagnostics and the registered repository. */
export interface QuickStartProjectResult {
	diagnostics: QuickStartProjectDiagnostic[];
	repository: RegisteredRepositorySnapshot | null;
	status: QuickStartProjectStatus;
	targetPath: string;
}

/**
 * Why a GitHub owner cannot receive a new repository.
 * `owner-access-restricted` covers an organization the token cannot reach at
 * all (SAML SSO, an enterprise 2FA policy); `owner-create-restricted` covers a
 * reachable organization that reserves repository creation for its owners.
 */
export type GithubOwnerRestrictionCode =
	| 'owner-access-restricted'
	| 'owner-create-restricted';

/** Why an owner is unpickable, as a translatable code plus main's own wording. */
export interface GithubOwnerRestriction {
	code: GithubOwnerRestrictionCode;
	message: string;
}

/** One selectable GitHub account a quick-start project can be published under. */
export interface GithubOwnerEntry {
	avatarUrl: string | null;
	canCreate: boolean;
	displayName: string | null;
	kind: 'organization' | 'user';
	login: string;
	restriction: GithubOwnerRestriction | null;
}

/** Result of enumerating the GitHub accounts the signed-in user belongs to. */
export interface GithubOwnerListResult {
	error?: string;
	generatedAt: string;
	owners: GithubOwnerEntry[];
	status: 'failure' | 'success';
}

/** Quick-start project scaffolding IPC surface. */
export interface QuickStartApi {
	githubOwnerList: () => Promise<GithubOwnerListResult>;
	quickStartProject: (
		request: QuickStartProjectRequest,
	) => Promise<QuickStartProjectResult>;
}
