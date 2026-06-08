import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation/route-profiler';
import type {
	ArchiveRepositoryRequest,
	ArchiveRepositoryResult,
	ArchiveWorkspaceRequest,
	ArchiveWorkspaceResult,
	CloneDestinationSelectionResult,
	CloneGithubRepositoryPrepareResult,
	CloneGithubRepositoryProgressEvent,
	CloneGithubRepositoryRequest,
	CloneGithubRepositoryStartRequest,
	CloneGithubRepositoryStartResult,
	CreateWorkspaceRequest,
	CreateWorkspaceResult,
	DeleteArchivedWorkspaceRequest,
	DeleteArchivedWorkspaceResult,
	DeleteRepositoryRequest,
	DeleteRepositoryResult,
	DeleteWorkspaceRequest,
	DeleteWorkspaceResult,
	EnsembleApi,
	ListPiModelsResult,
	ListPiSessionEventsResult,
	ListPiSessionsResult,
	LocalRepositorySelectionResult,
	OpenPiSessionRequest,
	OpenPiSessionResult,
	PiSessionEventBroadcast,
	QuickStartProjectRequest,
	QuickStartProjectResult,
	RegisterLocalRepositoryRequest,
	RegisterLocalRepositoryResult,
	RenameWorkspaceRequest,
	RenameWorkspaceResult,
	StopPiSessionRequest,
	StopPiSessionResult,
	SubmitPiPromptRequest,
	SubmitPiPromptResult,
	UnarchiveWorkspaceRequest,
	UnarchiveWorkspaceResult,
} from '@/shared/ipc';

/** Hierarchical TanStack Query keys for every Ensemble IPC-backed query. */
export const ensembleQueryKeys = {
	all: ['ensemble'] as const,
	archivedWorkspaces: (repositoryId: string) =>
		[...ensembleQueryKeys.all, 'archived-workspaces', repositoryId] as const,
	environmentVariables: () =>
		[...ensembleQueryKeys.all, 'environment-variables'] as const,
	githubRepositoryList: () =>
		[...ensembleQueryKeys.all, 'github-repository-list'] as const,
	health: () => [...ensembleQueryKeys.all, 'health'] as const,
	piModels: () => [...ensembleQueryKeys.all, 'pi-models'] as const,
	piSessionEvents: (branchId: string) =>
		[...ensembleQueryKeys.all, 'pi-session-events', branchId] as const,
	piSessionsForWorkspace: (workspaceId: string) =>
		[...ensembleQueryKeys.all, 'pi-sessions', workspaceId] as const,
	repositoryWorkspaceNavigation: () =>
		[...ensembleQueryKeys.all, 'repository-workspace-navigation'] as const,
	rootDirectory: () => [...ensembleQueryKeys.all, 'root-directory'] as const,
	setupDiagnostics: () =>
		[...ensembleQueryKeys.all, 'setup-diagnostics'] as const,
};

/**
 * Returns the `window.ensemble` bridge, throwing when the preload script did
 * not run (e.g. in unit tests).
 * @returns The {@link EnsembleApi} instance.
 */
function getEnsembleApi(): EnsembleApi {
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
function getEnsembleApiOrNull(): EnsembleApi | null {
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

/** Query options for the renderer-side health snapshot. */
export const healthQuery = queryOptions({
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemble:health', usesDatabase: true },
			() => getEnsembleApi().health(),
		),
	queryKey: ensembleQueryKeys.health(),
	staleTime: 5000,
});

/** Query options for the renderer-side environment-variables snapshot. */
export const environmentVariablesQuery = queryOptions({
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemble:environment-variables', usesDatabase: false },
			() => getEnsembleApi().environmentVariables(),
		),
	queryKey: ensembleQueryKeys.environmentVariables(),
	staleTime: 5000,
});

/** Query options for the gh-backed GitHub repository list. */
export const githubRepositoryListQuery = queryOptions({
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemble:github-repository-list', usesDatabase: false },
			() => getEnsembleApi().githubRepositoryList(),
		),
	queryKey: ensembleQueryKeys.githubRepositoryList(),
	staleTime: 60_000,
});

/** Query options for the renderer-side root directory snapshot. */
export const rootDirectoryQuery = queryOptions({
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemble:root-directory', usesDatabase: true },
			() => getEnsembleApi().rootDirectory(),
		),
	queryKey: ensembleQueryKeys.rootDirectory(),
	staleTime: 5000,
});

/** Query options for the renderer-side repository/workspace navigation snapshot. */
export const repositoryWorkspaceNavigationQuery = queryOptions({
	queryFn: () =>
		profileElectronIpcCall(
			{
				channel: 'ensemble:repository-workspace-navigation',
				usesDatabase: true,
			},
			() => getEnsembleApi().repositoryWorkspaceNavigation(),
		),
	queryKey: ensembleQueryKeys.repositoryWorkspaceNavigation(),
	staleTime: 2000,
});

/** Opens the native folder picker via the main process to choose a local repository. */
export function selectLocalRepository(): Promise<LocalRepositorySelectionResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:select-local-repository', usesDatabase: false },
		() => getEnsembleApi().selectLocalRepository(),
	);
}

/** Scaffolds a new local project under the managed root and registers it. */
export function quickStartProject(
	request: QuickStartProjectRequest,
): Promise<QuickStartProjectResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:quick-start-project', usesDatabase: true },
		() => getEnsembleApi().quickStartProject(request),
	);
}

/** Registers a previously-selected local repository path with Ensemble. */
export function registerLocalRepository(
	request: RegisterLocalRepositoryRequest,
): Promise<RegisterLocalRepositoryResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:register-local-repository', usesDatabase: true },
		() => getEnsembleApi().registerLocalRepository(request),
	);
}

/** Creates an isolated git worktree workspace under the managed root. */
export function createWorkspace(
	request: CreateWorkspaceRequest,
): Promise<CreateWorkspaceResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:create-workspace', usesDatabase: true },
		() => getEnsembleApi().createWorkspace(request),
	);
}

/** Renames an existing workspace, moving its worktree and (optionally) branch. */
export function renameWorkspace(
	request: RenameWorkspaceRequest,
): Promise<RenameWorkspaceResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:rename-workspace', usesDatabase: true },
		() => getEnsembleApi().renameWorkspace(request),
	);
}

/**
 * Lifecycle archive: preserves the workspace `.context/` under
 * `<root>/archived-contexts/`, stamps `workspaces.archived_at`, and records a
 * row in `archive_records`. The worktree folder stays on disk; branch cleanup
 * is opt-in via `request.branchCleanup`.
 */
export function archiveWorkspace(
	request: ArchiveWorkspaceRequest,
): Promise<ArchiveWorkspaceResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:archive-workspace', usesDatabase: true },
		() => getEnsembleApi().archiveWorkspace(request),
	);
}

/**
 * Lifecycle archive of a repository: cascades the workspace archive flow to
 * every child workspace, stamps `repositories.archived_at`, and records the
 * decision in `archive_records`.
 */
export function archiveRepository(
	request: ArchiveRepositoryRequest,
): Promise<ArchiveRepositoryResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:archive-repository', usesDatabase: true },
		() => getEnsembleApi().archiveRepository(request),
	);
}

/**
 * Lists archived workspaces for a repository, joined with the latest archive
 * record so the renderer can show branch cleanup status, preserved context
 * path, and base branch.
 */
export function archivedWorkspacesQuery(repositoryId: string) {
	return queryOptions({
		enabled: repositoryId.length > 0,
		queryFn: () =>
			profileElectronIpcCall(
				{
					channel: 'ensemble:list-archived-workspaces',
					usesDatabase: true,
				},
				() => getEnsembleApi().listArchivedWorkspaces({ repositoryId }),
			),
		queryKey: ensembleQueryKeys.archivedWorkspaces(repositoryId),
		staleTime: 2000,
	});
}

/**
 * Reverses a workspace lifecycle archive. Restores `.context/` from the
 * preserved snapshot; recreates the worktree from the recorded base branch
 * when the original archive ran with branch cleanup.
 */
export function unarchiveWorkspace(
	request: UnarchiveWorkspaceRequest,
): Promise<UnarchiveWorkspaceResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:unarchive-workspace', usesDatabase: true },
		() => getEnsembleApi().unarchiveWorkspace(request),
	);
}

/**
 * Permanently purges an archived workspace: drops the workspace row, removes
 * the preserved archived-contexts directory, and cleans up the worktree and
 * branch if still present on disk.
 */
export function deleteArchivedWorkspace(
	request: DeleteArchivedWorkspaceRequest,
): Promise<DeleteArchivedWorkspaceResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:delete-archived-workspace', usesDatabase: true },
		() => getEnsembleApi().deleteArchivedWorkspace(request),
	);
}

/** Permanently deletes a workspace from disk and SQLite. Destructive. */
export function deleteWorkspace(
	request: DeleteWorkspaceRequest,
): Promise<DeleteWorkspaceResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:delete-workspace', usesDatabase: true },
		() => getEnsembleApi().deleteWorkspace(request),
	);
}

/**
 * Permanently deletes a repository and its workspaces from Ensemble. Wipes
 * each worktree + branch and writes the `.ensemble-archived` sentinel so the
 * shared-root reconciler does not re-adopt the still-on-disk folder.
 */
export function deleteRepository(
	request: DeleteRepositoryRequest,
): Promise<DeleteRepositoryResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:delete-repository', usesDatabase: true },
		() => getEnsembleApi().deleteRepository(request),
	);
}

/** Opens the native folder picker to choose a clone destination parent folder. */
export function selectCloneDestination(): Promise<CloneDestinationSelectionResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:select-clone-destination', usesDatabase: false },
		() => getEnsembleApi().selectCloneDestination(),
	);
}

/** Validates a GitHub clone request and allocates a jobId. */
export function prepareCloneGithubRepository(
	request: CloneGithubRepositoryRequest,
): Promise<CloneGithubRepositoryPrepareResult> {
	return profileElectronIpcCall(
		{
			channel: 'ensemble:clone-github-repository:prepare',
			usesDatabase: false,
		},
		() => getEnsembleApi().prepareCloneGithubRepository(request),
	);
}

/** Executes a previously-prepared GitHub clone job. */
export function startCloneGithubRepository(
	request: CloneGithubRepositoryStartRequest,
): Promise<CloneGithubRepositoryStartResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:clone-github-repository:start', usesDatabase: true },
		() => getEnsembleApi().startCloneGithubRepository(request),
	);
}

/** Subscribes to clone-progress events; returns an unsubscribe function. */
export function subscribeCloneGithubRepositoryProgress(
	listener: (event: CloneGithubRepositoryProgressEvent) => void,
): () => void {
	const api = getEnsembleApiOrNull();
	if (!api) {
		return () => {
			// noop in environments without the preload bridge.
		};
	}
	return api.onCloneGithubRepositoryProgress(listener);
}

/** Query options for the static Pi model catalog. */
export const piModelsQuery = queryOptions({
	queryFn: (): Promise<ListPiModelsResult> =>
		profileElectronIpcCall(
			{ channel: 'ensemble:list-pi-models', usesDatabase: false },
			() => getEnsembleApi().listPiModels(),
		),
	queryKey: ensembleQueryKeys.piModels(),
	staleTime: 60_000,
});

/** Query options for the persisted Pi sessions of a single workspace. */
export function piSessionsForWorkspaceQuery(workspaceId: string) {
	return queryOptions({
		enabled: workspaceId.length > 0,
		queryFn: (): Promise<ListPiSessionsResult> =>
			profileElectronIpcCall(
				{ channel: 'ensemble:list-pi-sessions', usesDatabase: true },
				() => getEnsembleApi().listPiSessions({ workspaceId }),
			),
		queryKey: ensembleQueryKeys.piSessionsForWorkspace(workspaceId),
		staleTime: 2000,
	});
}

/** Opens (or attaches to) a Pi session for the given workspace. */
export function openPiSession(
	request: OpenPiSessionRequest,
): Promise<OpenPiSessionResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:open-pi-session', usesDatabase: true },
		() => getEnsembleApi().openPiSession(request),
	);
}

/** Submits a prompt to an open Pi session. */
export function submitPiPrompt(
	request: SubmitPiPromptRequest,
): Promise<SubmitPiPromptResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:submit-pi-prompt', usesDatabase: true },
		() => getEnsembleApi().submitPiPrompt(request),
	);
}

/** Query options for the persisted Pi events of a branch. */
export function piSessionEventsQuery(branchId: string) {
	return queryOptions({
		enabled: branchId.length > 0,
		queryFn: (): Promise<ListPiSessionEventsResult> =>
			profileElectronIpcCall(
				{
					channel: 'ensemble:list-pi-session-events',
					usesDatabase: true,
				},
				() => getEnsembleApi().listPiSessionEvents({ branchId }),
			),
		queryKey: ensembleQueryKeys.piSessionEvents(branchId),
		staleTime: 0,
	});
}

/** Subscribes to live Pi RPC event broadcasts. Returns an unsubscribe fn. */
export function subscribePiSessionEvents(
	listener: (event: PiSessionEventBroadcast) => void,
): () => void {
	const api = getEnsembleApiOrNull();
	if (!api) {
		return () => undefined;
	}
	return api.onPiSessionEvent(listener);
}

/** Aborts the in-flight turn of an open Pi session. */
export function stopPiSession(
	request: StopPiSessionRequest,
): Promise<StopPiSessionResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:stop-pi-session', usesDatabase: true },
		() => getEnsembleApi().stopPiSession(request),
	);
}

/** Query options for the renderer-side setup-diagnostics snapshot. */
export const setupDiagnosticsQuery = queryOptions({
	queryFn: () =>
		profileElectronIpcCall(
			{ channel: 'ensemble:setup-diagnostics', usesDatabase: true },
			() => getEnsembleApi().setupDiagnostics(),
		),
	queryKey: ensembleQueryKeys.setupDiagnostics(),
	staleTime: 2000,
});
