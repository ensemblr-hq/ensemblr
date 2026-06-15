import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	QuickStartProjectRequest,
	QuickStartProjectResult,
} from '@/shared/ipc/contracts/quick-start';
import type {
	DeleteRepositoryRequest,
	DeleteRepositoryResult,
	LocalRepositorySelectionResult,
	RegisterLocalRepositoryRequest,
	RegisterLocalRepositoryResult,
} from '@/shared/ipc/contracts/repository';
import type {
	CreateWorkspaceRequest,
	CreateWorkspaceResult,
	DeleteWorkspaceRequest,
	DeleteWorkspaceResult,
	RenameWorkspaceRequest,
	RenameWorkspaceResult,
} from '@/shared/ipc/contracts/workspace';

import { getEnsembleApi } from './query-keys';

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

/** Copies a selected local repository into managed repos and registers it. */
export function importLocalRepository(
	request: RegisterLocalRepositoryRequest,
): Promise<RegisterLocalRepositoryResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemble:import-local-repository', usesDatabase: true },
		() => getEnsembleApi().importLocalRepository(request),
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
