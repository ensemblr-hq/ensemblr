/** Settings publication failure categories localized by the renderer. */
export type SettingsPublicationFailureCode =
	| 'cleanup-unsafe'
	| 'database-unavailable'
	| 'destination-changed'
	| 'git-unavailable'
	| 'invalid-request'
	| 'merge-failed'
	| 'path-unsafe'
	| 'preview-not-found'
	| 'preview-stale'
	| 'publication-unexpected'
	| 'recovery-failed'
	| 'recovery-not-found'
	| 'source-changed'
	| 'source-invalid'
	| 'source-missing'
	| 'source-unreadable'
	| 'target-invalid'
	| 'target-not-found'
	| 'target-unreadable'
	| 'write-failed';

/** Locale-neutral settings publication failure. */
export interface SettingsPublicationFailure {
	code: SettingsPublicationFailureCode;
	message: string;
}

/** Root checkout state represented in a publication preview. */
export type SettingsPublicationSourceStatus =
	| 'deleted'
	| 'missing'
	| 'modified'
	| 'untracked';

/** Request to preview root settings in a chosen live workspace. */
export interface PreviewSettingsPublicationRequest {
	repositoryId: string;
	workspaceId: string;
}

/** Backend-owned preview of a three-way settings merge. */
export interface SettingsPublicationPreview {
	hasLegacyScripts: boolean;
	mergedText: string;
	repositoryId: string;
	sourceStatus: SettingsPublicationSourceStatus;
	status: 'clean' | 'conflict';
	token: string;
	workspaceId: string;
}

/** Outcome of preparing a publication. */
export interface PreviewSettingsPublicationResult {
	failure: SettingsPublicationFailure | null;
	preview: SettingsPublicationPreview | null;
}

/** Request to apply an unchanged backend-owned preview. */
export interface ApplySettingsPublicationRequest {
	previewToken: string;
	repositoryId: string;
	workspaceId: string;
}

/** Outcome of writing a clean publication preview. */
export interface ApplySettingsPublicationResult {
	failure: SettingsPublicationFailure | null;
	recoveryId: string | null;
	status: 'applied' | 'failed';
}

/** Request to remove the unchanged root copy after a verified publication. */
export interface CleanupSettingsPublicationRequest {
	recoveryId: string;
}

/** Outcome of an explicit root cleanup. */
export interface CleanupSettingsPublicationResult {
	failure: SettingsPublicationFailure | null;
	status: 'cleaned' | 'failed';
}

/** Recoverable copy in app storage; file contents never cross IPC. */
export interface SettingsPublicationRecoverySnapshot {
	appliedAt: string | null;
	cleanedAt: string | null;
	id: string;
	repositoryId: string;
	workspaceId: string;
}

/** Request to list recovery records for one repository. */
export interface SettingsPublicationRecoveryStatusRequest {
	repositoryId: string;
}

/** Available durable recoveries, newest first. */
export interface SettingsPublicationRecoveryStatusResult {
	failure: SettingsPublicationFailure | null;
	recoveries: SettingsPublicationRecoverySnapshot[];
}

/** Request to restore one captured copy if its destination is unchanged. */
export interface RestoreSettingsPublicationRequest {
	copy: 'destination' | 'source';
	recoveryId: string;
}

/** Outcome of restoring captured settings bytes. */
export interface RestoreSettingsPublicationResult {
	failure: SettingsPublicationFailure | null;
	status: 'failed' | 'restored';
}

/** Settings publication slice of the renderer bridge. */
export interface SettingsPublicationApi {
	applySettingsPublication: (
		request: ApplySettingsPublicationRequest,
	) => Promise<ApplySettingsPublicationResult>;
	cleanupSettingsPublication: (
		request: CleanupSettingsPublicationRequest,
	) => Promise<CleanupSettingsPublicationResult>;
	previewSettingsPublication: (
		request: PreviewSettingsPublicationRequest,
	) => Promise<PreviewSettingsPublicationResult>;
	restoreSettingsPublication: (
		request: RestoreSettingsPublicationRequest,
	) => Promise<RestoreSettingsPublicationResult>;
	settingsPublicationRecoveryStatus: (
		request: SettingsPublicationRecoveryStatusRequest,
	) => Promise<SettingsPublicationRecoveryStatusResult>;
}
