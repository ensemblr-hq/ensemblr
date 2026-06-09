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

/** Environment-variable inspection IPC surface. */
export interface EnvironmentApi {
	environmentVariables: () => Promise<EnvironmentVariablesSnapshot>;
}
