import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	CloneDestinationSelectionResult,
	CloneGithubRepositoryPrepareResult,
	CloneGithubRepositoryProgressEvent,
	CloneGithubRepositoryRequest,
	CloneGithubRepositoryStartRequest,
	CloneGithubRepositoryStartResult,
} from '@/shared/ipc';

import { getEnsembleApi, getEnsembleApiOrNull } from './query-keys';

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
