import type { QueryClient } from '@tanstack/react-query';

import type { RepositoryWorkspaceNavigationSnapshot } from '@/shared/ipc/contracts/repository-navigation';

import { ensemblrQueryKeys } from './query-keys';

/**
 * Drops one workspace from the cached navigation snapshot so every surface
 * reading it — the sidebar, the board, the workspace menu — stops rendering a
 * workspace that has already been removed.
 *
 * {@link invalidateWorkspaceListViews} is the reconciliation, not the update:
 * its refetch has to travel back through the main process, and making the UI
 * wait on that is what left a deleted workspace on screen until the app was
 * restarted.
 * @param queryClient - The renderer's query client
 * @param workspaceId - Workspace to drop from the cached lists
 */
export function forgetWorkspaceInListViews(
	queryClient: QueryClient,
	workspaceId: string,
): void {
	queryClient.setQueryData<RepositoryWorkspaceNavigationSnapshot>(
		ensemblrQueryKeys.repositoryWorkspaceNavigation(),
		(snapshot) => snapshotWithoutWorkspace(snapshot, workspaceId),
	);
}

/**
 * Rebuilds a navigation snapshot without one workspace, returning the snapshot
 * unchanged — same reference — when it never held that workspace. Identity
 * matters: the shell's selection effects key off the snapshot, so a fresh object
 * per call would re-run them on every unrelated removal.
 * @param snapshot - Cached snapshot, or undefined when the query has no data yet
 * @param workspaceId - Workspace to drop
 * @returns The snapshot without that workspace, or the original when unaffected
 */
function snapshotWithoutWorkspace(
	snapshot: RepositoryWorkspaceNavigationSnapshot | undefined,
	workspaceId: string,
): RepositoryWorkspaceNavigationSnapshot | undefined {
	if (!snapshot) {
		return snapshot;
	}

	let removed = false;
	const repositories = snapshot.repositories.map((repository) => {
		const workspaces = repository.workspaces.filter(
			(workspace) => workspace.id !== workspaceId,
		);
		if (workspaces.length === repository.workspaces.length) {
			return repository;
		}
		removed = true;
		return { ...repository, workspaces };
	});

	return removed ? { ...snapshot, repositories } : snapshot;
}
