import type { SettingsResolutionSource } from './settings-resolution';

export type EnvironmentVariableScope = 'app' | 'repository' | 'workspace';
export type EnvironmentVariableValueKind = 'plain' | 'runtime' | 'secret';
export type EnvironmentVariableStatus =
	| 'invalid'
	| 'masked'
	| 'reserved'
	| 'set'
	| 'unset';
export type EnvironmentVariableCategory =
	| 'custom'
	| 'generic'
	| 'pi'
	| 'provider'
	| 'proxy'
	| 'runtime';
export type EnvironmentVariableDiagnosticSeverity =
	| 'error'
	| 'info'
	| 'warning';
export type EnvironmentVariableSource =
	| SettingsResolutionSource
	| 'runtime'
	| 'secret-metadata';

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

export interface EnvironmentVariableDiagnostic {
	code: string;
	key?: string;
	message: string;
	severity: EnvironmentVariableDiagnosticSeverity;
}

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
