import type { QueryClient } from '@tanstack/react-query';
import type { useNavigate, useRouter } from '@tanstack/react-router';

import {
	createWorkspace,
	repositoryWorkspaceNavigationQuery,
} from '@/renderer/api/ensemblr-queries';
import { queryClient } from '@/renderer/api/query-client';
import type { RepositoryWorkspaceNavigationSnapshot } from '@/shared/ipc/contracts/repository-navigation';

import { mapRepositoriesToProjects } from './navigation-model';
import {
	resolveWorkspaceRouteParams,
	type StoredWorkspaceSelection,
} from './navigation-selection';
import { pickComposerSurname } from './workspace-name-pool';

/** Inputs for seeding a repository's first workspace: navigation, persistence, and the target repo. */
interface SeedFirstWorkspaceOptions {
	navigate: ReturnType<typeof useNavigate>;
	persistSelection: (selection: StoredWorkspaceSelection) => void;
	repositoryId: string;
	router?: ReturnType<typeof useRouter>;
}

/** Outcome of seeding a first workspace: success with the new id, or a failure reason. */
interface SeedFirstWorkspaceResult {
	error?: string;
	status: 'failure' | 'success';
	workspaceId?: string;
}

/**
 * Creates a fresh workspace for a newly-added repository and navigates to it.
 * Used by every add-project flow (register, quick-start, clone) so the user
 * lands directly in a usable workspace instead of an empty project shell.
 *
 * Caller passes an atom setter for the persisted last-selected workspace. The
 * atom is backed by `atomWithStorage`, so writing it syncs the same
 * localStorage key the route loader reads on cold boot — one path, no
 * double-write.
 */
export async function seedFirstWorkspace({
	navigate,
	persistSelection,
	repositoryId,
	router,
}: SeedFirstWorkspaceOptions): Promise<SeedFirstWorkspaceResult> {
	const name = pickComposerSurname();
	const result = await createWorkspace({
		name,
		placeholderName: true,
		repositoryId,
	});

	if (result.status !== 'success' || !result.workspace) {
		const reason =
			result.diagnostics.find((diagnostic) => diagnostic.severity === 'error')
				?.message ?? 'The starter workspace could not be created.';
		return { error: reason, status: 'failure' };
	}

	const workspaceId = result.workspace.id;
	let navigationSnapshot: RepositoryWorkspaceNavigationSnapshot;

	try {
		navigationSnapshot = await refreshRepositoryWorkspaceNavigationCache();
	} catch (error) {
		return {
			error: getNavigationRefreshErrorMessage(error),
			status: 'failure',
			workspaceId,
		};
	}

	const routeParams = resolveWorkspaceRouteParams(
		mapRepositoriesToProjects(navigationSnapshot.repositories),
		repositoryId,
		workspaceId,
	);

	if (!routeParams) {
		return {
			error:
				'The starter workspace was created, but the navigation snapshot did not include it yet.',
			status: 'failure',
			workspaceId,
		};
	}

	persistSelection({
		projectId: routeParams.projectId,
		workspaceId: routeParams.workspaceId,
	});

	if (router) {
		await router.invalidate();
	}

	await navigate({
		params: routeParams,
		replace: true,
		to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
	});

	return { status: 'success', workspaceId };
}

/**
 * Forces the repository/workspace navigation cache to reload from IPC even when
 * the bootstrapped snapshot is still marked fresh.
 * @param client - Query client whose navigation snapshot should be refreshed.
 * @returns The freshly fetched navigation snapshot.
 */
export async function refreshRepositoryWorkspaceNavigationCache(
	client: QueryClient = queryClient,
): Promise<RepositoryWorkspaceNavigationSnapshot> {
	await client.invalidateQueries({
		queryKey: repositoryWorkspaceNavigationQuery.queryKey,
		refetchType: 'none',
	});

	return client.fetchQuery({
		...repositoryWorkspaceNavigationQuery,
		staleTime: 0,
	});
}

/** Builds the user-facing message for a failed navigation-cache refresh. */
function getNavigationRefreshErrorMessage(error: unknown): string {
	return error instanceof Error
		? error.message
		: 'The starter workspace was created, but the navigation snapshot could not be refreshed.';
}
