import type {
	CreateTerminalSessionResult,
	KillTerminalResult,
} from './terminal';

/** Repository-configured workspace script kinds (ADR 0007). */
export type WorkspaceScriptKind = 'archive' | 'run' | 'setup';

export interface RunWorkspaceScriptRequest {
	kind: WorkspaceScriptKind;
	/** Stop the active session of this kind before starting a new one. */
	restart?: boolean;
	workspaceId: string;
}

/** Script sessions are terminal sessions; results share the terminal shapes. */
export type RunWorkspaceScriptResult = CreateTerminalSessionResult;

export interface StopWorkspaceScriptRequest {
	kind: WorkspaceScriptKind;
	workspaceId: string;
}

export type StopWorkspaceScriptResult = KillTerminalResult;

/** Workspace-script slice of the `window.ensemble` API. */
export interface WorkspaceScriptsApi {
	runWorkspaceScript: (
		request: RunWorkspaceScriptRequest,
	) => Promise<RunWorkspaceScriptResult>;
	stopWorkspaceScript: (
		request: StopWorkspaceScriptRequest,
	) => Promise<StopWorkspaceScriptResult>;
}
