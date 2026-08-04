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
	ContinueWorkspaceBranchRequest,
	ContinueWorkspaceBranchResult,
	CreateWorkspaceRequest,
	CreateWorkspaceResult,
	DeleteWorkspaceRequest,
	DeleteWorkspaceResult,
	RenameWorkspaceRequest,
	RenameWorkspaceResult,
} from '@/shared/ipc/contracts/workspace';

import { getEnsemblrApi } from './query-keys';

/** Opens the native folder picker via the main process to choose a local repository. */
export function selectLocalRepository(): Promise<LocalRepositorySelectionResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:select-local-repository', usesDatabase: false },
		() => getEnsemblrApi().selectLocalRepository(),
	);
}

/** Scaffolds a new local project under the managed root and registers it. */
export function quickStartProject(
	request: QuickStartProjectRequest,
): Promise<QuickStartProjectResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:quick-start-project', usesDatabase: true },
		() => getEnsemblrApi().quickStartProject(request),
	);
}

/** Copies a selected local repository into managed repos and registers it. */
export function importLocalRepository(
	request: RegisterLocalRepositoryRequest,
): Promise<RegisterLocalRepositoryResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:import-local-repository', usesDatabase: true },
		() => getEnsemblrApi().importLocalRepository(request),
	);
}

/** Creates an isolated git worktree workspace under the managed root. */
export function createWorkspace(
	request: CreateWorkspaceRequest,
): Promise<CreateWorkspaceResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:create-workspace', usesDatabase: true },
		() => getEnsemblrApi().createWorkspace(request),
	);
}

/** Renames an existing workspace, moving its worktree and (optionally) branch. */
export function renameWorkspace(
	request: RenameWorkspaceRequest,
): Promise<RenameWorkspaceResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:rename-workspace', usesDatabase: true },
		() => getEnsemblrApi().renameWorkspace(request),
	);
}

/**
 * Branches the workspace onto a `.v<n>` successor and checks it out, so work
 * continues without the merged pull request following along. The successor
 * forks from the base branch once the merged work is upstream, so the review
 * panel opens empty; the merged branch stays put.
 */
export function continueWorkspaceBranch(
	request: ContinueWorkspaceBranchRequest,
): Promise<ContinueWorkspaceBranchResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:continue-workspace-branch', usesDatabase: true },
		() => getEnsemblrApi().continueWorkspaceBranch(request),
	);
}

/** Permanently deletes a workspace from disk and SQLite. Destructive. */
export function deleteWorkspace(
	request: DeleteWorkspaceRequest,
): Promise<DeleteWorkspaceResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:delete-workspace', usesDatabase: true },
		() => getEnsemblrApi().deleteWorkspace(request),
	);
}

/**
 * Permanently deletes a repository and its workspaces from Ensemblr. Wipes
 * each worktree + branch and writes the `.ensemblr-archived` sentinel so the
 * shared-root reconciler does not re-adopt the still-on-disk folder.
 */
export function deleteRepository(
	request: DeleteRepositoryRequest,
): Promise<DeleteRepositoryResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:delete-repository', usesDatabase: true },
		() => getEnsemblrApi().deleteRepository(request),
	);
}
