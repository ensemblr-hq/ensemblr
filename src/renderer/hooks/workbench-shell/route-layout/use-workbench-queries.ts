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
 * Spread between one workspace's overview poll and the next.
 *
 * Every target shares one interval, so they were armed in the same render and
 * fired in the same tick: N workspaces meant N `git status
 * --untracked-files=all` fan-outs landing on the main process at once. Main
 * caps its own git concurrency, so this is about the request burst rather than
 * the spawn burst — it costs nothing and keeps the queue from arriving in one
 * lump. Capped so a long workspace list still refreshes on a predictable
 * cadence rather than drifting minutes apart.
 */
const OVERVIEW_GIT_STATUS_STAGGER_MS = 750;
/** How many staggered slots the workspace list is spread across. */
const OVERVIEW_GIT_STATUS_STAGGER_SLOTS = 8;

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
		queries: workspaceChangeSummaryTargets.map((target, index) => ({
			...workspaceGitStatusQuery(target.workspaceCwd, target.scope),
			enabled: hasPreloadBridge && target.workspaceCwd.length > 0,
			refetchInterval:
				OVERVIEW_GIT_STATUS_REFETCH_INTERVAL_MS +
				(index % OVERVIEW_GIT_STATUS_STAGGER_SLOTS) *
					OVERVIEW_GIT_STATUS_STAGGER_MS,
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
