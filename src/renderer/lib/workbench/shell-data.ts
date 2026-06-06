import type { QueryClient } from '@tanstack/react-query';
import {
	healthQuery,
	isEnsembleApiAvailable,
	repositoryWorkspaceNavigationQuery,
	setupDiagnosticsQuery,
} from '@/renderer/api/ensemble-queries';
import { shellFixtureProjects } from '@/renderer/mocks/workbench';
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

	const [healthResult, navigationResult, setupResult] =
		await Promise.allSettled([
			queryClient.fetchQuery(healthQuery),
			queryClient.fetchQuery(repositoryWorkspaceNavigationQuery),
			queryClient.fetchQuery(setupDiagnosticsQuery),
		]);
	const cachedNavigationSnapshot =
		queryClient.getQueryData<RepositoryWorkspaceNavigationSnapshot>(
			repositoryWorkspaceNavigationQuery.queryKey,
		);
	const navigationSnapshot = getRenderableNavigationSnapshot({
		cachedSnapshot: cachedNavigationSnapshot,
		querySnapshot:
			navigationResult.status === 'fulfilled'
				? navigationResult.value
				: undefined,
	});

	return {
		hasPreloadBridge,
		healthError:
			healthResult.status === 'rejected'
				? getErrorMessage(healthResult.reason)
				: null,
		healthSnapshot:
			healthResult.status === 'fulfilled'
				? healthResult.value
				: (queryClient.getQueryData<HealthSnapshot>(healthQuery.queryKey) ??
					null),
		navigationError:
			navigationResult.status === 'rejected'
				? getErrorMessage(navigationResult.reason)
				: null,
		navigationSnapshot,
		projects: mapRepositoriesToProjects(navigationSnapshot?.repositories),
		setupError:
			setupResult.status === 'rejected'
				? getErrorMessage(setupResult.reason)
				: null,
		setupSnapshot:
			setupResult.status === 'fulfilled'
				? setupResult.value
				: (queryClient.getQueryData<SetupDiagnosticsSnapshot>(
						setupDiagnosticsQuery.queryKey,
					) ?? null),
	};
}

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

export function getErrorMessage(error: unknown): string | null {
	if (!error) {
		return null;
	}

	return error instanceof Error
		? error.message
		: 'Unknown renderer query error';
}
