import type {
	CreateTerminalSessionResult,
	KillTerminalResult,
} from './terminal';

/** Repository-configured workspace script kinds (ADR 0007). */
export type WorkspaceScriptKind = 'archive' | 'run' | 'setup';

/** Request to run a repository-configured workspace script. */
export interface RunWorkspaceScriptRequest {
	kind: WorkspaceScriptKind;
	/** Stop the active session of this kind before starting a new one. */
	restart?: boolean;
	workspaceId: string;
}

/** Script sessions are terminal sessions; results share the terminal shapes. */
export type RunWorkspaceScriptResult = CreateTerminalSessionResult;

/** Request to stop a workspace's running script session of a given kind. */
export interface StopWorkspaceScriptRequest {
	kind: WorkspaceScriptKind;
	workspaceId: string;
}

/** Result of stopping a workspace script; shares the terminal-kill result shape. */
export type StopWorkspaceScriptResult = KillTerminalResult;

/**
 * Personal (SQLite-persisted) repository script settings edited on the Scripts
 * settings screen. Blank script commands clear their stored row. The committed
 * `.ensemblr/settings.toml` still overrides any of these keys per-key.
 */
export interface UpdateRepositoryScriptsRequest {
	archive: string | null;
	autoRunAfterSetup: boolean;
	repositoryId: string;
	run: string | null;
	runScriptMode: 'concurrent' | 'nonconcurrent';
	setup: string | null;
}

/** Result of a Scripts-settings write; `ok: false` means validation failed or the SQLite write errored. */
export interface UpdateRepositoryScriptsResult {
	ok: boolean;
}

/** Workspace-script slice of the `window.ensemblr` API. */
export interface WorkspaceScriptsApi {
	runWorkspaceScript: (
		request: RunWorkspaceScriptRequest,
	) => Promise<RunWorkspaceScriptResult>;
	stopWorkspaceScript: (
		request: StopWorkspaceScriptRequest,
	) => Promise<StopWorkspaceScriptResult>;
	updateRepositoryScripts: (
		request: UpdateRepositoryScriptsRequest,
	) => Promise<UpdateRepositoryScriptsResult>;
}
