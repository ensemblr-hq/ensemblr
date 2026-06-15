import { getRouteApi } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import type { WorkbenchLayoutModel } from '@/renderer/components/workbench-shell/shell-contexts';
import { useWorkbenchNavigation } from '@/renderer/hooks/workbench-shell/route-layout/use-workbench-navigation';
import { useWorkbenchQueries } from '@/renderer/hooks/workbench-shell/route-layout/use-workbench-queries';
import { useWorkspaceSelectionPersistence } from '@/renderer/hooks/workbench-shell/route-layout/use-workspace-selection-persistence';
import { getErrorMessage } from '@/renderer/lib/error';
import { getWorkbenchHealth } from '@/renderer/lib/workbench';
import type { WorkbenchShellRouteState } from '@/renderer/types/components';
import type {
	NavigationContextValue,
	SetupDiagnosticsContextValue,
} from '@/renderer/types/contexts';
import type { WorkbenchShellData } from '@/renderer/types/workbench';

export const workbenchRouteApi = getRouteApi('/_workbench');

export interface WorkbenchLayoutModelBundle {
	model: WorkbenchLayoutModel;
	navigation: NavigationContextValue;
	setupDiagnostics: SetupDiagnosticsContextValue;
}

/**
 * Thin compositor that wires together three focused hooks:
 *  - {@link useWorkbenchQueries} for the live IPC-backed data
 *  - {@link useWorkspaceSelectionPersistence} for selection state
 *  - {@link useWorkbenchNavigation} for routing and add-project actions
 */
export function useWorkbenchLayoutModel({
	loaderData,
	routeState,
}: {
	loaderData: WorkbenchShellData;
	routeState: WorkbenchShellRouteState;
}): WorkbenchLayoutModelBundle {
	const queries = useWorkbenchQueries({ loaderData });
	const setupError =
		getErrorMessage(queries.setupDiagnosticsErrorResult) ??
		loaderData.setupError;
	const setupSnapshot =
		queries.setupDiagnosticsData ?? loaderData.setupSnapshot ?? null;
	const healthError =
		getErrorMessage(queries.healthErrorResult) ??
		loaderData.healthError ??
		null;

	const { displayProjects, displaySelection } =
		useWorkspaceSelectionPersistence({
			hasPreloadBridge: queries.hasPreloadBridge,
			isRepositoryWorkspaceNavigationFetching:
				queries.isRepositoryWorkspaceNavigationFetching,
			isRepositoryWorkspaceNavigationLoading:
				queries.isRepositoryWorkspaceNavigationLoading,
			isRepositoryWorkspaceNavigationPlaceholderData:
				queries.isRepositoryWorkspaceNavigationPlaceholderData,
			navigationSnapshot: queries.navigationSnapshot,
			projects: queries.projects,
			routeState,
		});

	const shellHealth = useMemo(
		() =>
			getWorkbenchHealth({
				hasPreloadBridge: queries.hasPreloadBridge,
				healthError,
				healthSnapshot: queries.healthData ?? loaderData.healthSnapshot ?? null,
				setupError,
				setupSnapshot,
			}),
		[
			queries.hasPreloadBridge,
			queries.healthData,
			healthError,
			loaderData.healthSnapshot,
			setupError,
			setupSnapshot,
		],
	);

	const nav = useWorkbenchNavigation({ displayProjects, setupSnapshot });

	const onSetupDiagnosticsRetry = useCallback(() => {
		if (queries.hasPreloadBridge) {
			void queries.refetchSetupDiagnostics();
		}
	}, [queries.hasPreloadBridge, queries.refetchSetupDiagnostics]);

	const model: WorkbenchLayoutModel = {
		activeProject: displaySelection?.project ?? null,
		activeWorkspace: displaySelection?.workspace ?? null,
		addProjectMenu: nav.addProjectMenu,
		displayProjects,
		displaySelection,
		health: shellHealth,
		navigateToStaticRoute: nav.navigateToStaticRoute,
		navigateToWorkspace: nav.navigateToWorkspace,
		onAddProject: nav.onAddProject,
		resolveWorkspaceRouteSearch: nav.resolveWorkspaceRouteSearch,
	};

	return {
		model,
		navigation: nav.navigation,
		setupDiagnostics: {
			state: {
				setupDiagnostics: setupSnapshot,
				setupDiagnosticsError: setupError,
				isSetupDiagnosticsRetrying: queries.isSetupDiagnosticsFetching,
			},
			actions: { onSetupDiagnosticsRetry },
		},
	};
}
