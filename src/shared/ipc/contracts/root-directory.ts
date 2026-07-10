import type {
	ResolvedSettingSnapshot,
	SettingsResolutionSource,
} from './settings-resolution';

/** Overall health status of the managed root directory. */
export type RootDirectoryStatus = 'error' | 'ok' | 'warning';
/** Severity level of a root-directory diagnostic. */
export type RootDirectoryDiagnosticSeverity = 'error' | 'info' | 'warning';
/** Identifier for one of the subdirectories Ensemblr manages under the root. */
export type RootDirectoryManagedPathKey =
	| 'archived-contexts'
	| 'repos'
	| 'workspaces';
/** On-disk state of a managed root subdirectory. */
export type RootDirectoryManagedPathStatus =
	| 'created'
	| 'invalid'
	| 'missing'
	| 'present';

/** A single diagnostic about the managed root directory. */
export interface RootDirectoryDiagnostic {
	code: string;
	message: string;
	path?: string;
	severity: RootDirectoryDiagnosticSeverity;
}

/** Snapshot of one managed subdirectory under the root and its status. */
export interface RootDirectoryManagedPathSnapshot {
	key: RootDirectoryManagedPathKey;
	path: string;
	status: RootDirectoryManagedPathStatus;
}

/** Snapshot of the resolved root directory, its managed paths, and diagnostics. */
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

/** Overall status of a root-directory reconciliation scan. */
export type RootDirectoryReconciliationStatus = 'error' | 'ok' | 'warning';

/** Result of scanning the root directory to reconcile on-disk repositories and workspaces. */
export interface RootDirectoryReconciliationSnapshot {
	diagnostics: RootDirectoryDiagnostic[];
	repositoryDirectoryCount: number;
	scannedAt: string;
	status: RootDirectoryReconciliationStatus;
	workspaceDirectoryCount: number;
}

/** Preview of a root-directory change, showing the prospective new root before it is applied. */
export interface RootDirectoryChangePreview {
	canApply: boolean;
	diagnostics: RootDirectoryDiagnostic[];
	newRoot: RootDirectorySnapshot;
	oldRoot: RootDirectorySnapshot | null;
	oldRootPreserved: true;
}

/** Result of prompting the user to pick a new root directory. */
export interface RootDirectorySelectionResult {
	canceled: boolean;
	error?: string;
	preview?: RootDirectoryChangePreview;
}

/** Request to change the managed root directory to a new path. */
export interface RootDirectoryChangeRequest {
	path: string;
}

/** Result of applying a root-directory change, including reconciliation of the new root. */
export interface RootDirectoryChangeApplyResult {
	applied: boolean;
	error?: string;
	newRoot: RootDirectorySnapshot | null;
	oldRoot: RootDirectorySnapshot | null;
	oldRootPreserved: true;
	reconciliation: RootDirectoryReconciliationSnapshot | null;
}

/** Root-directory IPC surface (read snapshot, pick a new root, apply change). */
export interface RootDirectoryApi {
	confirmRootDirectoryChange: (
		request: RootDirectoryChangeRequest,
	) => Promise<RootDirectoryChangeApplyResult>;
	rootDirectory: () => Promise<RootDirectorySnapshot>;
	selectRootDirectory: () => Promise<RootDirectorySelectionResult>;
}
