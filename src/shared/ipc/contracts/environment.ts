import type { SettingsResolutionSource } from './settings-resolution';

/** Scope an environment variable belongs to: app-wide, per-repository, or per-workspace. */
export type EnvironmentVariableScope = 'app' | 'repository' | 'workspace';
/** How an environment variable's value is treated: plain text, runtime-resolved, or a secret. */
export type EnvironmentVariableValueKind = 'plain' | 'runtime' | 'secret';
/** Resolution status of an environment variable (set, unset, masked, reserved, or invalid). */
export type EnvironmentVariableStatus =
	| 'invalid'
	| 'masked'
	| 'reserved'
	| 'set'
	| 'unset';
/** Grouping used to organize environment variables in the settings UI. */
export type EnvironmentVariableCategory =
	| 'custom'
	| 'generic'
	| 'pi'
	| 'provider'
	| 'proxy'
	| 'runtime';
/** Severity level for an environment-variable diagnostic. */
export type EnvironmentVariableDiagnosticSeverity =
	| 'error'
	| 'info'
	| 'warning';
/** Where an environment variable's resolved value came from. */
export type EnvironmentVariableSource =
	| SettingsResolutionSource
	| 'runtime'
	| 'secret-metadata';

/** Catalog metadata describing a known environment variable (title, scope, requirements). */
export interface EnvironmentVariableCatalogEntrySnapshot {
	category: EnvironmentVariableCategory;
	description: string;
	key: string;
	required: boolean;
	reserved: boolean;
	scope: EnvironmentVariableScope;
	title: string;
	valueKind: EnvironmentVariableValueKind;
}

/** A diagnostic about an environment variable's configuration. */
export interface EnvironmentVariableDiagnostic {
	code: string;
	key?: string;
	message: string;
	severity: EnvironmentVariableDiagnosticSeverity;
}

/** Resolved state of a single environment variable, including its catalog entry and display value. */
export interface EnvironmentVariableSnapshot {
	catalog: EnvironmentVariableCatalogEntrySnapshot;
	characterCount?: number;
	displayValue?: string;
	key: string;
	maskedDisplay?: string;
	required: boolean;
	scope: EnvironmentVariableScope;
	scopeId: string;
	source: EnvironmentVariableSource | null;
	status: EnvironmentVariableStatus;
	valueKind: EnvironmentVariableValueKind;
}

/** Full snapshot of resolved environment variables, plus catalog, diagnostics, and required-count summary. */
export interface EnvironmentVariablesSnapshot {
	catalog: EnvironmentVariableCatalogEntrySnapshot[];
	diagnostics: EnvironmentVariableDiagnostic[];
	generatedAt: string;
	missingRequiredCount: number;
	requiredCount: number;
	variables: EnvironmentVariableSnapshot[];
}

/** Request to create or update a single environment variable. */
export interface SetEnvironmentVariableRequest {
	key: string;
	scope: EnvironmentVariableScope;
	scopeId?: string;
	value: string;
	/** When set and different from `key`, the prior variable is removed first. */
	previousKey?: string;
}

/** Request to remove a single environment variable. */
export interface UnsetEnvironmentVariableRequest {
	key: string;
	scope: EnvironmentVariableScope;
	scopeId?: string;
}

/** Request to read the raw stored value of a single environment variable. */
export interface ReadEnvironmentVariableValueRequest {
	key: string;
	scope: EnvironmentVariableScope;
	scopeId?: string;
}

/** Raw value of a single environment variable (`null` when unset). */
export interface ReadEnvironmentVariableValueResult {
	value: string | null;
}

/** Identifies a scope for env-file list operations. */
export interface EnvironmentFilesScopeRequest {
	scope: EnvironmentVariableScope;
	scopeId?: string;
}

/** Request to add or remove a single env-file path. */
export interface EnvironmentFileRequest {
	path: string;
	scope: EnvironmentVariableScope;
	scopeId?: string;
}

/** Current env-file paths for a scope, plus an error when a mutation failed. */
export interface EnvironmentFilesResult {
	error?: string;
	paths: string[];
}

/** Result of asking the user to pick an env file from disk. */
export interface SelectEnvFileResult {
	canceled: boolean;
	path?: string;
}

/** Mutation result envelope used by the environment write/read handlers. */
export interface EnvironmentMutationResult {
	error?: string;
	snapshot?: EnvironmentVariableSnapshot;
}

/** Environment-variable inspection and management IPC surface. */
export interface EnvironmentApi {
	addEnvFile: (
		request: EnvironmentFileRequest,
	) => Promise<EnvironmentFilesResult>;
	environmentVariables: () => Promise<EnvironmentVariablesSnapshot>;
	listEnvFiles: (
		request: EnvironmentFilesScopeRequest,
	) => Promise<EnvironmentFilesResult>;
	readEnvironmentVariableValue: (
		request: ReadEnvironmentVariableValueRequest,
	) => Promise<ReadEnvironmentVariableValueResult>;
	removeEnvFile: (
		request: EnvironmentFileRequest,
	) => Promise<EnvironmentFilesResult>;
	selectEnvFile: () => Promise<SelectEnvFileResult>;
	setEnvironmentVariable: (
		request: SetEnvironmentVariableRequest,
	) => Promise<EnvironmentMutationResult>;
	unsetEnvironmentVariable: (
		request: UnsetEnvironmentVariableRequest,
	) => Promise<EnvironmentMutationResult>;
}
