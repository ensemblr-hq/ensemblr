import {
	keepPreviousData,
	useQueries,
	useQuery,
	useQueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';
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
	const projects = useQueries({
		combine: (results) =>
			applyWorkspaceChangeSummaries(
				baseProjects,
				collectWorkspaceChangeSummaryUpdates(
					results,
					workspaceChangeSummaryTargets,
				),
			),
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
