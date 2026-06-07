import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation/route-profiler';
import type {
	CloneDestinationSelectionResult,
	CloneGithubRepositoryPrepareResult,
	CloneGithubRepositoryProgressEvent,
	CloneGithubRepositoryRequest,
	CloneGithubRepositoryStartRequest,
	CloneGithubRepositoryStartResult,
	EnsembleApi,
	GithubRepositoryListResult,
	LocalRepositorySelectionResult,
	RegisterLocalRepositoryRequest,
	RegisterLocalRepositoryResult,
} from '@/shared/ipc';

/** Hierarchical TanStack Query keys for every Ensemble IPC-backed query. */
export const ensembleQueryKeys = {
	all: ['ensemble'] as const,
	environmentVariables: () =>
		[...ensembleQueryKeys.all, 'environment-variables'] as const,
	githubRepositoryList: () =>
		[...ensembleQueryKeys.all, 'github-repository-list'] as const,
	health: () => [...ensembleQueryKeys.all, 'health'] as const,
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
 * Tests whether the preload bridge has been wired into the current window.
 * @returns True when `window.ensemble` is present.
 */
export function isEnsembleApiAvailable(): boolean {
	return typeof window !== 'undefined' && Boolean(window.ensemble);
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

/** Registers a previously-selected local repository path with Ensemble. */
export function registerLocalRepository(
	request: RegisterLocalRepositoryRequest,
): Promise<RegisterLocalRepositoryResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:register-local-repository', usesDatabase: true },
		() => getEnsembleApi().registerLocalRepository(request),
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
	const api = window.ensemble;
	if (!api) {
		return () => {
			// noop in environments without the preload bridge.
		};
	}
	return api.onCloneGithubRepositoryProgress(listener);
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
