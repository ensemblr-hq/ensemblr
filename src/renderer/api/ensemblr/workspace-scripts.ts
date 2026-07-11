import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	EnsureWorkspaceSetupRequest,
	EnsureWorkspaceSetupResult,
	RunWorkspaceScriptRequest,
	RunWorkspaceScriptResult,
	StopWorkspaceScriptRequest,
	StopWorkspaceScriptResult,
	UpdateRepositoryScriptsRequest,
	UpdateRepositoryScriptsResult,
} from '@/shared/ipc/contracts/workspace-scripts';

import { getEnsemblrApi } from './query-keys';

/**
 * Asks the main process to run the workspace setup script only when its
 * dependency fingerprint is missing or stale. Fired once per workspace open so
 * unchanged dependencies skip setup and a changed lockfile re-runs it.
 */
export function ensureWorkspaceSetup(
	request: EnsureWorkspaceSetupRequest,
): Promise<EnsureWorkspaceSetupResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:ensure-workspace-setup', usesDatabase: true },
		() => getEnsemblrApi().ensureWorkspaceSetup(request),
	);
}

/** Runs a configured workspace script in a dock terminal session. */
export function runWorkspaceScript(
	request: RunWorkspaceScriptRequest,
): Promise<RunWorkspaceScriptResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:run-workspace-script', usesDatabase: true },
		() => getEnsemblrApi().runWorkspaceScript(request),
	);
}

/** Stops the active workspace script session of the given kind. */
export function stopWorkspaceScript(
	request: StopWorkspaceScriptRequest,
): Promise<StopWorkspaceScriptResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:stop-workspace-script', usesDatabase: false },
		() => getEnsemblrApi().stopWorkspaceScript(request),
	);
}

/** Persists the Scripts settings screen edits to repository-scoped SQLite. */
export function updateRepositoryScripts(
	request: UpdateRepositoryScriptsRequest,
): Promise<UpdateRepositoryScriptsResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:update-repository-scripts', usesDatabase: true },
		() => getEnsemblrApi().updateRepositoryScripts(request),
	);
}
