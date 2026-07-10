import type { EnsemblrApi } from '@/shared/ipc/contracts/api';

/** Hierarchical TanStack Query keys for every Ensemblr IPC-backed query. */
export const ensemblrQueryKeys = {
	agentActionTemplates: (repositoryId: string) =>
		[...ensemblrQueryKeys.all, 'agent-action-templates', repositoryId] as const,
	all: ['ensemblr'] as const,
	archivedWorkspaces: (repositoryId: string) =>
		[...ensemblrQueryKeys.all, 'archived-workspaces', repositoryId] as const,
	chatTabs: (workspaceId: string) =>
		[...ensemblrQueryKeys.all, 'chat-tabs', workspaceId] as const,
	checkpointsForSession: (piSessionId: string) =>
		[...ensemblrQueryKeys.all, 'checkpoints', piSessionId] as const,
	closedChatTabsWithSummary: (workspaceId: string) =>
		[
			...ensemblrQueryKeys.all,
			'closed-chat-tabs-with-summary',
			workspaceId,
		] as const,
	environmentFiles: (scope: string, scopeId?: string) =>
		[
			...ensemblrQueryKeys.all,
			'environment-files',
			scope,
			scopeId ?? '',
		] as const,
	environmentVariables: () =>
		[...ensemblrQueryKeys.all, 'environment-variables'] as const,
	filePreview: (workspaceCwd: string, filePath: string) =>
		[...ensemblrQueryKeys.all, 'file-preview', workspaceCwd, filePath] as const,
	githubRepositoryList: (scope: 'full' | 'recent' = 'recent') =>
		[...ensemblrQueryKeys.all, 'github-repository-list', scope] as const,
	health: () => [...ensemblrQueryKeys.all, 'health'] as const,
	linearConnection: () =>
		[...ensemblrQueryKeys.all, 'linear-connection'] as const,
	linearIssue: (issueId: string) =>
		[...ensemblrQueryKeys.all, 'linear-issue', issueId] as const,
	linearIssues: (filter: { query?: string; teamId?: string }) =>
		[
			...ensemblrQueryKeys.all,
			'linear-issues',
			filter.teamId ?? '',
			filter.query ?? '',
		] as const,
	/** Prefix matching every cached issue list regardless of filter. */
	linearIssuesAll: () => [...ensemblrQueryKeys.all, 'linear-issues'] as const,
	linearMetadata: () => [...ensemblrQueryKeys.all, 'linear-metadata'] as const,
	piModels: () => [...ensemblrQueryKeys.all, 'pi-models'] as const,
	piSlashCommands: (workspaceCwd: string) =>
		[...ensemblrQueryKeys.all, 'pi-slash-commands', workspaceCwd] as const,
	piSessionEvents: (branchId: string) =>
		[...ensemblrQueryKeys.all, 'pi-session-events', branchId] as const,
	piSessionsForWorkspace: (workspaceId: string) =>
		[...ensemblrQueryKeys.all, 'pi-sessions', workspaceId] as const,
	pullRequestSnapshot: (workspaceId: string) =>
		[...ensemblrQueryKeys.all, 'pull-request-snapshot', workspaceId] as const,
	repositoryBranches: (repositoryId: string) =>
		[...ensemblrQueryKeys.all, 'repository-branches', repositoryId] as const,
	/** Prefix matching every repository's cached branch list. */
	repositoryBranchesAll: () =>
		[...ensemblrQueryKeys.all, 'repository-branches'] as const,
	repositoryIssues: (repositoryId: string) =>
		[...ensemblrQueryKeys.all, 'repository-issues', repositoryId] as const,
	repositoryPullRequests: (repositoryId: string) =>
		[
			...ensemblrQueryKeys.all,
			'repository-pull-requests',
			repositoryId,
		] as const,
	reviewComments: (workspaceId: string) =>
		[...ensemblrQueryKeys.all, 'review-comments', workspaceId] as const,
	reviewMergeSettings: (repositoryId: string) =>
		[...ensemblrQueryKeys.all, 'review-merge-settings', repositoryId] as const,
	reviewTodos: (workspaceId: string) =>
		[...ensemblrQueryKeys.all, 'review-todos', workspaceId] as const,
	turnDiff: (turnId: string) =>
		[...ensemblrQueryKeys.all, 'turn-diff', turnId] as const,
	workspaceHistory: () =>
		[...ensemblrQueryKeys.all, 'workspace-history'] as const,
	repositoryWorkspaceNavigation: () =>
		[...ensemblrQueryKeys.all, 'repository-workspace-navigation'] as const,
	rootDirectory: () => [...ensemblrQueryKeys.all, 'root-directory'] as const,
	repositoryConfig: (repositoryPath: string) =>
		[...ensemblrQueryKeys.all, 'repository-config', repositoryPath] as const,
	setupDiagnostics: () =>
		[...ensemblrQueryKeys.all, 'setup-diagnostics'] as const,
	settingsResolution: (repositoryId: string | null) =>
		[
			...ensemblrQueryKeys.all,
			'settings-resolution',
			repositoryId ?? '',
		] as const,
	workspaceCommits: (workspaceCwd: string, baseRef = '') =>
		[
			...ensemblrQueryKeys.all,
			'workspace-commits',
			workspaceCwd,
			baseRef,
		] as const,
	workspaceFileDiff: (
		workspaceCwd: string,
		filePath: string,
		scopeKey = 'working-tree',
	) =>
		[
			...ensemblrQueryKeys.all,
			'workspace-file-diff',
			workspaceCwd,
			filePath,
			scopeKey,
		] as const,
	workspaceFiles: (workspaceCwd: string) =>
		[...ensemblrQueryKeys.all, 'workspace-files', workspaceCwd] as const,
	workspaceGitStatus: (workspaceCwd: string, scopeKey = 'working-tree') =>
		[
			...ensemblrQueryKeys.all,
			'workspace-git-status',
			workspaceCwd,
			scopeKey,
		] as const,
	workspaceOpenTargets: () =>
		[...ensemblrQueryKeys.all, 'workspace-open-targets'] as const,
};

/**
 * Returns the `window.ensemblr` bridge, throwing when the preload script did
 * not run (e.g. in unit tests).
 * @returns The {@link EnsemblrApi} instance.
 */
export function getEnsemblrApi(): EnsemblrApi {
	const ensemblr = window.ensemblr;

	if (!ensemblr) {
		throw new Error('Electron preload bridge is unavailable in this context.');
	}

	return ensemblr;
}

/**
 * Returns the `window.ensemblr` bridge if present, otherwise `null`. Use for
 * subscription/notification call sites where a missing bridge should degrade
 * to a no-op rather than throw.
 */
export function getEnsemblrApiOrNull(): EnsemblrApi | null {
	if (typeof window === 'undefined') {
		return null;
	}
	return window.ensemblr ?? null;
}

/**
 * Tests whether the preload bridge has been wired into the current window.
 * @returns True when `window.ensemblr` is present.
 */
export function isEnsemblrApiAvailable(): boolean {
	return getEnsemblrApiOrNull() !== null;
}
