import { queryOptions } from '@tanstack/react-query';

import { profileElectronIpcCall } from '@/renderer/lib/instrumentation';
import type {
	ArchiveWorkspaceRequest,
	ArchiveWorkspaceResult,
	DeleteArchivedWorkspaceRequest,
	DeleteArchivedWorkspaceResult,
	ReclaimArchivedWorkspaceDiskRequest,
	ReclaimArchivedWorkspaceDiskResult,
	UnarchiveWorkspaceRequest,
	UnarchiveWorkspaceResult,
} from '@/shared/ipc/contracts/workspace';

import { ensemblrQueryKeys, getEnsemblrApi } from './query-keys';

/**
 * Lifecycle archive: preserves the workspace `.context/` under
 * `<root>/archived-contexts/`, stamps `workspaces.archived_at`, and records a
 * row in `archive_records`. What happens to the worktree is opt-in:
 * `request.reclaimDisk` removes it and keeps the branch, `request.branchCleanup`
 * removes it and drops the branch.
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
 * preserved snapshot; re-derives a pruned worktree by checking its branch out
 * again, or recreates one from the recorded base branch when the original
 * archive dropped the branch.
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

/**
 * Reclaims the disk archived workspaces still occupy, removing each worktree
 * while keeping its branch and a snapshot of any uncommitted changes. Takes a
 * list so one call serves both a single row and the bulk action.
 */
export function reclaimArchivedWorkspaceDisk(
	request: ReclaimArchivedWorkspaceDiskRequest,
): Promise<ReclaimArchivedWorkspaceDiskResult> {
	return profileElectronIpcCall(
		{ channel: 'ensemblr:reclaim-archived-workspace-disk', usesDatabase: true },
		() => getEnsemblrApi().reclaimArchivedWorkspaceDisk(request),
	);
}
