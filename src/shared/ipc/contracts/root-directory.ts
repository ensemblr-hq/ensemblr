import type {
	ResolvedSettingSnapshot,
	SettingsResolutionSource,
} from './settings-resolution';

export type RootDirectoryStatus = 'error' | 'ok' | 'warning';
export type RootDirectoryDiagnosticSeverity = 'error' | 'info' | 'warning';
export type RootDirectoryManagedPathKey =
	| 'archived-contexts'
	| 'repos'
	| 'workspaces';
export type RootDirectoryManagedPathStatus =
	| 'created'
	| 'invalid'
	| 'missing'
	| 'present';

export interface RootDirectoryDiagnostic {
	code: string;
	message: string;
	path?: string;
	severity: RootDirectoryDiagnosticSeverity;
}

export interface RootDirectoryManagedPathSnapshot {
	key: RootDirectoryManagedPathKey;
	path: string;
	status: RootDirectoryManagedPathStatus;
}

export interface RootDirectorySnapshot {
	archivedContextsPath: string;
	createdPaths: string[];
	diagnostics: RootDirectoryDiagnostic[];
	managedPaths: RootDirectoryManagedPathSnapshot[];
	path: string;
	repositoriesPath: string;
	setting: ResolvedSettingSnapshot | null;
	source: SettingsResolutionSource | null;
	status: RootDirectoryStatus;
	workspacesPath: string;
}

export type RootDirectoryReconciliationStatus = 'error' | 'ok' | 'warning';

export interface RootDirectoryReconciliationSnapshot {
	diagnostics: RootDirectoryDiagnostic[];
	repositoryDirectoryCount: number;
	scannedAt: string;
	status: RootDirectoryReconciliationStatus;
	workspaceDirectoryCount: number;
}

export interface RootDirectoryChangePreview {
	canApply: boolean;
	diagnostics: RootDirectoryDiagnostic[];
	newRoot: RootDirectorySnapshot;
	oldRoot: RootDirectorySnapshot | null;
	oldRootPreserved: true;
}

export interface RootDirectorySelectionResult {
	canceled: boolean;
	error?: string;
	preview?: RootDirectoryChangePreview;
}

export interface RootDirectoryChangeRequest {
	path: string;
}

export interface RootDirectoryChangeApplyResult {
	applied: boolean;
	error?: string;
	newRoot: RootDirectorySnapshot | null;
	oldRoot: RootDirectorySnapshot | null;
	oldRootPreserved: true;
	reconciliation: RootDirectoryReconciliationSnapshot | null;
}
