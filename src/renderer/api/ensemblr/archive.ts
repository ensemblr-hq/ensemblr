import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	ArchiveRepositoryRequest,
	ArchiveRepositoryResult,
} from '@/shared/ipc/contracts/repository';
import type {
	ArchiveWorkspaceRequest,
	ArchiveWorkspaceResult,
	DeleteArchivedWorkspaceRequest,
	DeleteArchivedWorkspaceResult,
	UnarchiveWorkspaceRequest,
	UnarchiveWorkspaceResult,
} from '@/shared/ipc/contracts/workspace';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

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
		{ channel: 'ensemblr:archive-workspace', usesDatabase: true },
		() => getEnsemblrApi().archiveWorkspace(request),
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
		{ channel: 'ensemblr:archive-repository', usesDatabase: true },
		() => getEnsemblrApi().archiveRepository(request),
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
					channel: 'ensemblr:list-archived-workspaces',
					usesDatabase: true,
				},
				() => getEnsemblrApi().listArchivedWorkspaces({ repositoryId }),
			),
		queryKey: ensemblrQueryKeys.archivedWorkspaces(repositoryId),
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
		{ channel: 'ensemblr:unarchive-workspace', usesDatabase: true },
		() => getEnsemblrApi().unarchiveWorkspace(request),
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
		{ channel: 'ensemblr:delete-archived-workspace', usesDatabase: true },
		() => getEnsemblrApi().deleteArchivedWorkspace(request),
	);
}
