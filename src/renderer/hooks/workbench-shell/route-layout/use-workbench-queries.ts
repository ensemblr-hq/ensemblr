import {
	keepPreviousData,
	useQueries,
	useQuery,
	useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
	healthQuery,
	isEnsemblrApiAvailable,
	repositoryWorkspaceNavigationQuery,
	setupDiagnosticsQuery,
	workspaceGitStatusQuery,
} from '@/renderer/api/ensemblr-queries';
import {
	applyWorkspaceChangeSummaries,
	collectWorkspaceChangeSummaryUpdates,
	getNavigationWorkspaceChangeSummaryTargets,
	getRenderableNavigationSnapshot,
	mapRepositoriesToProjects,
} from '@/renderer/lib/workbench';
import type { WorkbenchShellData } from '@/renderer/types/workbench';
import type { RepositoryWorkspaceNavigationSnapshot } from '@/shared/ipc/contracts/repository-navigation';

// The sidebar/board diff stats are a glanceable overview, not the active
// workspace's live detail (which keeps the 10s poll in workspaceGitStatusQuery).
// A slower fan-out interval keeps N per-workspace git-status calls cheap.
const OVERVIEW_GIT_STATUS_REFETCH_INTERVAL_MS = 30_000;

/**
 * Owns the three workbench-shell live queries (health, repository workspace
 * navigation, setup diagnostics), the preload-bridge gating, the navigation
 * snapshot resolution, and the navigation -> projects mapping.
 */
export function useWorkbenchQueries({
	loaderData,
}: {
	loaderData: WorkbenchShellData;
}) {
	const { i18n } = useTranslation();
	const queryClient = useQueryClient();
	const hasPreloadBridge = isEnsemblrApiAvailable();
	const { data: healthData, error: healthErrorResult } = useQuery({
		...healthQuery,
		enabled: hasPreloadBridge,
	});
	const {
		data: repositoryWorkspaceNavigationData,
		isFetching: isRepositoryWorkspaceNavigationFetching,
		isLoading: isRepositoryWorkspaceNavigationLoading,
		isPlaceholderData: isRepositoryWorkspaceNavigationPlaceholderData,
	} = useQuery({
		...repositoryWorkspaceNavigationQuery,
		enabled: hasPreloadBridge,
		placeholderData: keepPreviousData,
	});
	const {
		data: setupDiagnosticsData,
		error: setupDiagnosticsErrorResult,
		refetch: refetchSetupDiagnostics,
	} = useQuery({
		...setupDiagnosticsQuery,
		enabled: hasPreloadBridge,
	});

	const cachedNavigationSnapshot =
		queryClient.getQueryData<RepositoryWorkspaceNavigationSnapshot>(
			repositoryWorkspaceNavigationQuery.queryKey,
		);
	const navigationSnapshot = getRenderableNavigationSnapshot({
		cachedSnapshot: cachedNavigationSnapshot,
		querySnapshot:
			repositoryWorkspaceNavigationData ??
			loaderData.navigationSnapshot ??
			undefined,
	});
	const navigationRepositories = navigationSnapshot?.repositories;
	// biome-ignore lint/correctness/useExhaustiveDependencies: project rows are translated through the i18n singleton, so the language is a real input Biome cannot see.
	const baseProjects = useMemo(
		() =>
			hasPreloadBridge ? mapRepositoriesToProjects(navigationRepositories) : [],
		[hasPreloadBridge, navigationRepositories, i18n.language],
	);
	const workspaceChangeSummaryTargets = useMemo(
		() => getNavigationWorkspaceChangeSummaryTargets(navigationRepositories),
		[navigationRepositories],
	);
	// `combine` has to be referentially stable: TanStack Query keys the combined
	// result's structural sharing off this function's identity, so an inline
	// arrow rebuilds the project list on every render. Downstream state keys off
	// that list's identity, and a list that is new every render drives an
	// unbounded render loop that pegs the renderer with no error to show for it.
	const combineWorkspaceChangeSummaries = useCallback(
		(results: Parameters<typeof collectWorkspaceChangeSummaryUpdates>[0]) =>
			applyWorkspaceChangeSummaries(
				baseProjects,
				collectWorkspaceChangeSummaryUpdates(
					results,
					workspaceChangeSummaryTargets,
				),
			),
		[baseProjects, workspaceChangeSummaryTargets],
	);
	const projects = useQueries({
		combine: combineWorkspaceChangeSummaries,
		queries: workspaceChangeSummaryTargets.map((target) => ({
			...workspaceGitStatusQuery(target.workspaceCwd, target.scope),
			enabled: hasPreloadBridge && target.workspaceCwd.length > 0,
			refetchInterval: OVERVIEW_GIT_STATUS_REFETCH_INTERVAL_MS,
		})),
	});

	return {
		hasPreloadBridge,
		healthData,
		healthErrorResult,
		isRepositoryWorkspaceNavigationFetching,
		isRepositoryWorkspaceNavigationLoading,
		isRepositoryWorkspaceNavigationPlaceholderData,
		navigationSnapshot,
		projects,
		refetchSetupDiagnostics,
		setupDiagnosticsData,
		setupDiagnosticsErrorResult,
	};
}
