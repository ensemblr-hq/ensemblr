import type { EnsemblrApi } from '@/shared/ipc/contracts/api';

/** Hierarchical TanStack Query keys for every Ensemblr IPC-backed query. */
export const ensemblrQueryKeys = {
	/** Query key for a repository's resolved agent action templates. */
	agentActionTemplates: (repositoryId: string) =>
		[...ensemblrQueryKeys.all, 'agent-action-templates', repositoryId] as const,
	all: ['ensemblr'] as const,
	/** Query key for a repository's archived workspaces. */
	archivedWorkspaces: (repositoryId: string) =>
		[...ensemblrQueryKeys.all, 'archived-workspaces', repositoryId] as const,
	/** Query key for a workspace's open chat tabs. */
	chatTabs: (workspaceId: string) =>
		[...ensemblrQueryKeys.all, 'chat-tabs', workspaceId] as const,
	/** Query key for a Pi session's checkpoints. */
	checkpointsForSession: (piSessionId: string) =>
		[...ensemblrQueryKeys.all, 'checkpoints', piSessionId] as const,
	/** Query key for a workspace's closed chat tabs with their summaries. */
	closedChatTabsWithSummary: (workspaceId: string) =>
		[
			...ensemblrQueryKeys.all,
			'closed-chat-tabs-with-summary',
			workspaceId,
		] as const,
	/** Query key for the environment files in a given scope. */
	environmentFiles: (scope: string, scopeId?: string) =>
		[
			...ensemblrQueryKeys.all,
			'environment-files',
			scope,
			scopeId ?? '',
		] as const,
	/** Query key for the environment variables list. */
	environmentVariables: () =>
		[...ensemblrQueryKeys.all, 'environment-variables'] as const,
	/** Query key for a file's preview within a workspace. */
	filePreview: (workspaceCwd: string, filePath: string) =>
		[...ensemblrQueryKeys.all, 'file-preview', workspaceCwd, filePath] as const,
	/** Query key for the GitHub repository list, scoped to full or recent. */
	githubRepositoryList: (scope: 'full' | 'recent' = 'recent') =>
		[...ensemblrQueryKeys.all, 'github-repository-list', scope] as const,
	/** Query key for the backend health check. */
	health: () => [...ensemblrQueryKeys.all, 'health'] as const,
	/** Query key for the Linear connection status. */
	linearConnection: () =>
		[...ensemblrQueryKeys.all, 'linear-connection'] as const,
	/** Query key for a single Linear issue by id. */
	linearIssue: (issueId: string) =>
		[...ensemblrQueryKeys.all, 'linear-issue', issueId] as const,
	/** Query key for a filtered Linear issue list. */
	linearIssues: (filter: { query?: string; teamId?: string }) =>
		[
			...ensemblrQueryKeys.all,
			'linear-issues',
			filter.teamId ?? '',
			filter.query ?? '',
		] as const,
	/** Prefix matching every cached issue list regardless of filter. */
	linearIssuesAll: () => [...ensemblrQueryKeys.all, 'linear-issues'] as const,
	/** Query key for cached Linear workspace metadata. */
	linearMetadata: () => [...ensemblrQueryKeys.all, 'linear-metadata'] as const,
	/** Query key for the available Pi models. */
	piModels: () => [...ensemblrQueryKeys.all, 'pi-models'] as const,
	/** Query key for a workspace's available Pi slash commands. */
	piSlashCommands: (workspaceCwd: string) =>
		[...ensemblrQueryKeys.all, 'pi-slash-commands', workspaceCwd] as const,
	/** Query key for a branch's Pi session events. */
	piSessionEvents: (branchId: string) =>
		[...ensemblrQueryKeys.all, 'pi-session-events', branchId] as const,
	/** Query key for a workspace's Pi sessions. */
	piSessionsForWorkspace: (workspaceId: string) =>
		[...ensemblrQueryKeys.all, 'pi-sessions', workspaceId] as const,
	/** Query key for a workspace's pull-request snapshot. */
	pullRequestSnapshot: (workspaceId: string) =>
		[...ensemblrQueryKeys.all, 'pull-request-snapshot', workspaceId] as const,
	/** Query key for a repository's branches. */
	repositoryBranches: (repositoryId: string) =>
		[...ensemblrQueryKeys.all, 'repository-branches', repositoryId] as const,
	/** Prefix matching every repository's cached branch list. */
	repositoryBranchesAll: () =>
		[...ensemblrQueryKeys.all, 'repository-branches'] as const,
	/** Query key for a repository's issues. */
	repositoryIssues: (repositoryId: string) =>
		[...ensemblrQueryKeys.all, 'repository-issues', repositoryId] as const,
	/** Query key for a repository's pull requests. */
	repositoryPullRequests: (repositoryId: string) =>
		[
			...ensemblrQueryKeys.all,
			'repository-pull-requests',
			repositoryId,
		] as const,
	/** Query key for a workspace's review comments. */
	reviewComments: (workspaceId: string) =>
		[...ensemblrQueryKeys.all, 'review-comments', workspaceId] as const,
	/** Query key for a repository's review merge settings. */
	reviewMergeSettings: (repositoryId: string) =>
		[...ensemblrQueryKeys.all, 'review-merge-settings', repositoryId] as const,
	/** Query key for a workspace's review to-dos. */
	reviewTodos: (workspaceId: string) =>
		[...ensemblrQueryKeys.all, 'review-todos', workspaceId] as const,
	/** Query key for a single turn's diff. */
	turnDiff: (turnId: string) =>
		[...ensemblrQueryKeys.all, 'turn-diff', turnId] as const,
	/** Query key for the workspace history list. */
	workspaceHistory: () =>
		[...ensemblrQueryKeys.all, 'workspace-history'] as const,
	/** Query key for the repository and workspace navigation tree. */
	repositoryWorkspaceNavigation: () =>
		[...ensemblrQueryKeys.all, 'repository-workspace-navigation'] as const,
	/** Query key for the configured root directory. */
	rootDirectory: () => [...ensemblrQueryKeys.all, 'root-directory'] as const,
	/** Query key for a repository's on-disk configuration. */
	repositoryConfig: (repositoryPath: string) =>
		[...ensemblrQueryKeys.all, 'repository-config', repositoryPath] as const,
	/** Query key for the setup-diagnostics snapshot. */
	setupDiagnostics: () =>
		[...ensemblrQueryKeys.all, 'setup-diagnostics'] as const,
	/** Query key for a resolved settings snapshot, optionally scoped by repository path. */
	settingsResolution: (repositoryId: string | null, repositoryPath?: string) =>
		repositoryPath
			? ([
					...ensemblrQueryKeys.all,
					'settings-resolution',
					repositoryId ?? '',
					repositoryPath,
				] as const)
			: ([
					...ensemblrQueryKeys.all,
					'settings-resolution',
					repositoryId ?? '',
				] as const),
	/** Query key for a workspace's commits relative to a base ref. */
	workspaceCommits: (workspaceCwd: string, baseRef = '') =>
		[
			...ensemblrQueryKeys.all,
			'workspace-commits',
			workspaceCwd,
			baseRef,
		] as const,
	/** Query key for a single file's diff within a workspace and scope. */
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
	/** Query key for a workspace's file list. */
	workspaceFiles: (workspaceCwd: string) =>
		[...ensemblrQueryKeys.all, 'workspace-files', workspaceCwd] as const,
	/** Query key for a workspace's git status within a scope. */
	workspaceGitStatus: (workspaceCwd: string, scopeKey = 'working-tree') =>
		[
			...ensemblrQueryKeys.all,
			'workspace-git-status',
			workspaceCwd,
			scopeKey,
		] as const,
	/** Query key for the available workspace open targets. */
	workspaceOpenTargets: () =>
		[...ensemblrQueryKeys.all, 'workspace-open-targets'] as const,
	/**
	 * Prefix key matching every workspace's desktop-runtime query. Invalidate it
	 * when Scripts settings change, since detection reads the run command and a
	 * repo can back multiple workspaces.
	 */
	workspaceDesktopRuntimeAll: () =>
		[...ensemblrQueryKeys.all, 'workspace-desktop-runtime'] as const,
	/** Query key for a workspace's detected desktop runtime. */
	workspaceDesktopRuntime: (workspaceId: string) =>
		[...ensemblrQueryKeys.workspaceDesktopRuntimeAll(), workspaceId] as const,
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
