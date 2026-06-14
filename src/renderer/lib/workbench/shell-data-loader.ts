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
 * falling back to {@link loadFixtureShellData} when the preload bridge is
 * absent (web preview / Storybook).
 * @param queryClient - Shared TanStack Query client.
 * @returns A {@link WorkbenchShellData} for the shell renderer.
 */
export async function loadWorkbenchShellData(
	queryClient: QueryClient,
): Promise<WorkbenchShellData> {
	if (!isEnsembleApiAvailable()) {
		return loadFixtureShellData();
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
		hasPreloadBridge: true,
		healthError: null,
		healthSnapshot: cachedHealthSnapshot ?? null,
		navigationError: null,
		navigationSnapshot,
		projects: mapRepositoriesToProjects(navigationSnapshot?.repositories),
		setupError: null,
		setupSnapshot: cachedSetupSnapshot ?? null,
	};
}

/**
 * Returns a fixture-backed `WorkbenchShellData` for contexts where the Electron
 * preload bridge is missing — web preview, Storybook, and SSR-style snapshot
 * runs. Kept separate from {@link loadWorkbenchShellData} so the live path
 * does not import fixtures into its hot code path.
 */
function loadFixtureShellData(): WorkbenchShellData {
	return {
		hasPreloadBridge: false,
		healthError: null,
		healthSnapshot: null,
		navigationError: null,
		navigationSnapshot: null,
		projects: shellFixtureProjects,
		setupError: null,
		setupSnapshot: null,
	};
}
