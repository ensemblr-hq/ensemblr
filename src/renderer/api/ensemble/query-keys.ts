import type { EnsembleApi } from '@/shared/ipc';

/** Hierarchical TanStack Query keys for every Ensemble IPC-backed query. */
export const ensembleQueryKeys = {
	all: ['ensemble'] as const,
	archivedWorkspaces: (repositoryId: string) =>
		[...ensembleQueryKeys.all, 'archived-workspaces', repositoryId] as const,
	chatTabs: (workspaceId: string) =>
		[...ensembleQueryKeys.all, 'chat-tabs', workspaceId] as const,
	checkpointsForSession: (piSessionId: string) =>
		[...ensembleQueryKeys.all, 'checkpoints', piSessionId] as const,
	closedChatTabsWithSummary: (workspaceId: string) =>
		[
			...ensembleQueryKeys.all,
			'closed-chat-tabs-with-summary',
			workspaceId,
		] as const,
	environmentVariables: () =>
		[...ensembleQueryKeys.all, 'environment-variables'] as const,
	filePreview: (workspaceCwd: string, filePath: string) =>
		[...ensembleQueryKeys.all, 'file-preview', workspaceCwd, filePath] as const,
	githubRepositoryList: () =>
		[...ensembleQueryKeys.all, 'github-repository-list'] as const,
	health: () => [...ensembleQueryKeys.all, 'health'] as const,
	piModels: () => [...ensembleQueryKeys.all, 'pi-models'] as const,
	piSlashCommands: (workspaceCwd: string) =>
		[...ensembleQueryKeys.all, 'pi-slash-commands', workspaceCwd] as const,
	piSessionEvents: (branchId: string) =>
		[...ensembleQueryKeys.all, 'pi-session-events', branchId] as const,
	piSessionsForWorkspace: (workspaceId: string) =>
		[...ensembleQueryKeys.all, 'pi-sessions', workspaceId] as const,
	turnDiff: (turnId: string) =>
		[...ensembleQueryKeys.all, 'turn-diff', turnId] as const,
	repositoryWorkspaceNavigation: () =>
		[...ensembleQueryKeys.all, 'repository-workspace-navigation'] as const,
	rootDirectory: () => [...ensembleQueryKeys.all, 'root-directory'] as const,
	setupDiagnostics: () =>
		[...ensembleQueryKeys.all, 'setup-diagnostics'] as const,
	workspaceFiles: (workspaceCwd: string) =>
		[...ensembleQueryKeys.all, 'workspace-files', workspaceCwd] as const,
	workspaceScriptSettings: (repositoryId: string) =>
		[
			...ensembleQueryKeys.all,
			'workspace-script-settings',
			repositoryId,
		] as const,
};

/**
 * Returns the `window.ensemble` bridge, throwing when the preload script did
 * not run (e.g. in unit tests).
 * @returns The {@link EnsembleApi} instance.
 */
export function getEnsembleApi(): EnsembleApi {
	const ensemble = window.ensemble;

	if (!ensemble) {
		throw new Error('Electron preload bridge is unavailable in this context.');
	}

	return ensemble;
}

/**
 * Returns the `window.ensemble` bridge if present, otherwise `null`. Use for
 * subscription/notification call sites where a missing bridge should degrade
 * to a no-op rather than throw.
 */
export function getEnsembleApiOrNull(): EnsembleApi | null {
	if (typeof window === 'undefined') {
		return null;
	}
	return window.ensemble ?? null;
}

/**
 * Tests whether the preload bridge has been wired into the current window.
 * @returns True when `window.ensemble` is present.
 */
export function isEnsembleApiAvailable(): boolean {
	return getEnsembleApiOrNull() !== null;
}
