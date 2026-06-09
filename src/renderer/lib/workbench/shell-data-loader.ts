import type { QueryClient } from '@tanstack/react-query';

import {
	healthQuery,
	isEnsembleApiAvailable,
	repositoryWorkspaceNavigationQuery,
	setupDiagnosticsQuery,
} from '@/renderer/api/ensemble-queries';
import { shellFixtureProjects } from '@/renderer/fixtures/workbench';
import type { WorkbenchShellData } from '@/renderer/types/workbench';
import type {
	HealthSnapshot,
	RepositoryWorkspaceNavigationSnapshot,
	SetupDiagnosticsSnapshot,
} from '@/shared/ipc';

import {
	getRenderableNavigationSnapshot,
	mapRepositoriesToProjects,
} from './navigation-model';

/**
 * Loads every dataset the workbench shell needs (health, navigation, setup),
 * falling back to mocks when the preload bridge is absent.
 * @param queryClient - Shared TanStack Query client.
 * @returns A {@link WorkbenchShellData} for the shell renderer.
 */
export async function loadWorkbenchShellData(
	queryClient: QueryClient,
): Promise<WorkbenchShellData> {
	const hasPreloadBridge = isEnsembleApiAvailable();

	if (!hasPreloadBridge) {
		return {
			hasPreloadBridge,
			healthError: null,
			healthSnapshot: null,
			navigationError: null,
			navigationSnapshot: null,
			projects: shellFixtureProjects,
			setupError: null,
			setupSnapshot: null,
		};
	}

	// Kick off background refreshes but never block the loader: the renderer
	// reads from the TanStack Query cache (seeded by the preload script at boot)
	// and the navigation/setup hooks subscribe to refetches once they land.
	void queryClient.prefetchQuery(healthQuery).catch(() => undefined);
	void queryClient
		.prefetchQuery(repositoryWorkspaceNavigationQuery)
		.catch(() => undefined);
	void queryClient.prefetchQuery(setupDiagnosticsQuery).catch(() => undefined);

	const cachedNavigationSnapshot =
		queryClient.getQueryData<RepositoryWorkspaceNavigationSnapshot>(
			repositoryWorkspaceNavigationQuery.queryKey,
		);
	const cachedHealthSnapshot = queryClient.getQueryData<HealthSnapshot>(
		healthQuery.queryKey,
	);
	const cachedSetupSnapshot =
		queryClient.getQueryData<SetupDiagnosticsSnapshot>(
			setupDiagnosticsQuery.queryKey,
		);
	const navigationSnapshot = getRenderableNavigationSnapshot({
		cachedSnapshot: cachedNavigationSnapshot,
		querySnapshot: undefined,
	});

	return {
		hasPreloadBridge,
		healthError: null,
		healthSnapshot: cachedHealthSnapshot ?? null,
		navigationError: null,
		navigationSnapshot,
		projects: mapRepositoriesToProjects(navigationSnapshot?.repositories),
		setupError: null,
		setupSnapshot: cachedSetupSnapshot ?? null,
	};
}
