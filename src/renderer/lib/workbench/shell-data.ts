import type { QueryClient } from '@tanstack/react-query';
import {
	healthQuery,
	isEnsembleApiAvailable,
	repositoryWorkspaceNavigationQuery,
	setupDiagnosticsQuery,
} from '@/renderer/api/ensemble-queries';
import { shellFixtureProjects } from '@/renderer/fixtures/workbench';
import type { WorkbenchShellData } from '@/renderer/types/workbench';
import type { WorkbenchHealth } from '@/renderer/types/workbench-shell';
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

/**
 * Reduces the loaded shell data into a single {@link WorkbenchHealth} value
 * suitable for the header status badge.
 * @param input - Shell data subset (bridge state, health, setup).
 * @returns A workbench health summary.
 */
export function getWorkbenchHealth({
	hasPreloadBridge,
	healthError,
	healthSnapshot,
	setupError,
	setupSnapshot,
}: {
	hasPreloadBridge: boolean;
	healthError: string | null;
	healthSnapshot: HealthSnapshot | null;
	setupError: string | null;
	setupSnapshot: SetupDiagnosticsSnapshot | null;
}): WorkbenchHealth {
	if (!hasPreloadBridge) {
		return {
			detail: 'Electron preload bridge is unavailable in this context.',
			label: 'IPC unavailable',
			state: 'unavailable',
		};
	}

	if (healthSnapshot) {
		if (healthSnapshot.database.status === 'error') {
			return {
				detail: healthSnapshot.database.error ?? 'Database failed to open.',
				label: `${healthSnapshot.appName} database unavailable`,
				state: 'unavailable',
			};
		}

		if (healthSnapshot.config.blocksReadiness) {
			return {
				detail:
					healthSnapshot.config.diagnostics[0]?.message ??
					'Declarative config blocks readiness.',
				label: `${healthSnapshot.appName} config requires attention`,
				state: 'unavailable',
			};
		}

		if (setupError) {
			return {
				detail: setupError,
				label: 'Setup diagnostics unavailable',
				state: 'unavailable',
			};
		}

		if (!setupSnapshot) {
			return {
				detail: 'Ensemble is collecting setup readiness checks.',
				label: 'Checking setup',
				state: 'pending',
			};
		}

		if (setupSnapshot.status !== 'ready') {
			return {
				detail: `${setupSnapshot.blockedCount} required setup checks need attention.`,
				label:
					setupSnapshot.status === 'checking'
						? 'Setup checks pending'
						: 'Setup blocked',
				state: setupSnapshot.status === 'checking' ? 'pending' : 'unavailable',
			};
		}

		return {
			detail: `Electron ${healthSnapshot.versions.electron} on ${healthSnapshot.platform}. Database schema v${healthSnapshot.database.schemaVersion}.`,
			label: `${healthSnapshot.appName} IPC online`,
			state: 'online',
		};
	}

	if (healthError) {
		return {
			detail: healthError,
			label: 'IPC unavailable',
			state: 'unavailable',
		};
	}

	return {
		detail:
			'Renderer is calling the typed preload bridge through TanStack Query.',
		label: 'Checking IPC',
		state: 'pending',
	};
}

/**
 * Picks the empty-state title and detail surfaced by the workspace navigation
 * sidebar based on loading state, errors and project count.
 * @param input - Loading state, navigation error, project count, setup status.
 * @returns A `{ title, detail }` empty-state copy block.
 */
export function getEmptyStateCopy({
	isLoading,
	navigationError,
	projectCount,
	setupStatus,
}: {
	isLoading: boolean;
	navigationError: string | null;
	projectCount: number;
	setupStatus?: string;
}) {
	if (isLoading) {
		return {
			detail: 'Ensemble is reading repositories and workspaces from SQLite.',
			title: 'Loading repositories',
		};
	}

	if (navigationError) {
		return {
			detail: navigationError,
			title: 'Repository navigation unavailable',
		};
	}

	if (setupStatus !== 'ready') {
		return {
			detail: 'Complete setup checks before creating or opening workspaces.',
			title: 'Setup required',
		};
	}

	if (projectCount > 0) {
		return {
			detail:
				'Repositories are registered, but none have active workspaces yet.',
			title: 'No active workspaces',
		};
	}

	return {
		detail: 'Open or create a repository to populate the workspace navigation.',
		title: 'No repositories yet',
	};
}
