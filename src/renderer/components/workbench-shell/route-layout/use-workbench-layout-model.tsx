import {
	keepPreviousData,
	useQuery,
	useQueryClient,
} from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useAtom, useAtomValue } from 'jotai';
import { type ReactElement, useCallback, useEffect, useMemo } from 'react';

import {
	healthQuery,
	isEnsembleApiAvailable,
	repositoryWorkspaceNavigationQuery,
	setupDiagnosticsQuery,
} from '@/renderer/api/ensemble-queries';
import { getErrorMessage } from '@/renderer/lib/error';
import {
	buildAddProjectMenuModel,
	findWorkspaceNavigationSelection,
	getRenderableNavigationSnapshot,
	getWorkbenchHealth,
	getWorkbenchStaticRoute,
	mapRepositoriesToProjects,
	resolveWorkspaceNavigationRenderState,
	resolveWorkspaceNavigationSelection,
} from '@/renderer/lib/workbench';
import { shellFixtureProjects } from '@/renderer/mocks/workbench';
import { recentProjectsAtom } from '@/renderer/state/recents';
import {
	activeChatTabByWorkspaceAtom,
	activeDockTabByWorkspaceAtom,
	activeReviewTabByWorkspaceAtom,
	getPreferredChatId,
	getPreferredDockTab,
	getPreferredReviewTab,
	lastWorkspaceNavigationRenderStateAtom,
	lastWorkspaceSelectionAtom,
} from '@/renderer/state/workspace';
import type { WorkbenchShellRouteState } from '@/renderer/types/components';
import type {
	NavigationContextValue,
	SetupDiagnosticsContextValue,
} from '@/renderer/types/contexts';
import type {
	WorkbenchRouteSearch,
	WorkbenchShellData,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type {
	WorkbenchHealth,
	WorkbenchStaticNavigationTarget,
	WorkbenchWorkspaceNavigationLinkTarget,
} from '@/renderer/types/workbench-shell';
import type { RepositoryWorkspaceNavigationSnapshot } from '@/shared/ipc';

import type { WorkbenchLayoutModel } from './layout-model-context';

export const workbenchRouteApi = getRouteApi('/_workbench');

export interface WorkbenchLayoutModelBundle {
	model: WorkbenchLayoutModel;
	navigation: NavigationContextValue;
	setupDiagnostics: SetupDiagnosticsContextValue;
}

/**
 * Builds the workbench layout model — combining loader data, live queries,
 * persisted prefs, and navigation handlers — for descendant routes.
 */
export function useWorkbenchLayoutModel({
	loaderData,
	routeState,
}: {
	loaderData: WorkbenchShellData;
	routeState: WorkbenchShellRouteState;
}): WorkbenchLayoutModelBundle {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const hasPreloadBridge = isEnsembleApiAvailable();
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
		isFetching: isSetupDiagnosticsFetching,
		refetch: refetchSetupDiagnostics,
	} = useQuery({
		...setupDiagnosticsQuery,
		enabled: hasPreloadBridge,
	});
	const [lastWorkspaceSelection, setLastWorkspaceSelection] = useAtom(
		lastWorkspaceSelectionAtom,
	);
	const [
		lastWorkspaceNavigationRenderState,
		setLastWorkspaceNavigationRenderState,
	] = useAtom(lastWorkspaceNavigationRenderStateAtom);
	const recentProjects = useAtomValue(recentProjectsAtom);
	const reviewTabsByWorkspace = useAtomValue(activeReviewTabByWorkspaceAtom);
	const dockTabsByWorkspace = useAtomValue(activeDockTabByWorkspaceAtom);
	const chatTabsByWorkspace = useAtomValue(activeChatTabByWorkspaceAtom);
	const setupError =
		getErrorMessage(setupDiagnosticsErrorResult) ?? loaderData.setupError;
	const setupSnapshot =
		setupDiagnosticsData ?? loaderData.setupSnapshot ?? null;
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
	const projects = useMemo(
		() =>
			hasPreloadBridge
				? mapRepositoriesToProjects(navigationRepositories)
				: shellFixtureProjects,
		[hasPreloadBridge, navigationRepositories],
	);
	const currentSelection = useMemo(
		() =>
			resolveWorkspaceNavigationSelection({
				projects,
				routeProjectId: routeState.routeProjectId,
				routeWorkspaceId: routeState.routeWorkspaceId,
				storedSelection:
					routeState.routeProjectId && routeState.routeWorkspaceId
						? undefined
						: lastWorkspaceSelection,
			}),
		[
			projects,
			routeState.routeProjectId,
			routeState.routeWorkspaceId,
			lastWorkspaceSelection,
		],
	);
	const navigationRenderState = useMemo(
		() =>
			resolveWorkspaceNavigationRenderState({
				canUsePreviousState:
					hasPreloadBridge &&
					!currentSelection &&
					(isRepositoryWorkspaceNavigationLoading ||
						isRepositoryWorkspaceNavigationFetching ||
						isRepositoryWorkspaceNavigationPlaceholderData ||
						!navigationSnapshot),
				previousState: lastWorkspaceNavigationRenderState,
				projects,
				routeProjectId: routeState.routeProjectId,
				routeWorkspaceId: routeState.routeWorkspaceId,
				selection: currentSelection,
			}),
		[
			currentSelection,
			hasPreloadBridge,
			lastWorkspaceNavigationRenderState,
			navigationSnapshot,
			projects,
			isRepositoryWorkspaceNavigationFetching,
			isRepositoryWorkspaceNavigationLoading,
			isRepositoryWorkspaceNavigationPlaceholderData,
			routeState.routeProjectId,
			routeState.routeWorkspaceId,
		],
	);
	const displayProjects = navigationRenderState?.projects ?? projects;
	const displaySelection = navigationRenderState?.selection ?? null;
	const healthError =
		getErrorMessage(healthErrorResult) ?? loaderData.healthError ?? null;
	const shellHealth = useMemo<WorkbenchHealth>(
		() =>
			getWorkbenchHealth({
				hasPreloadBridge,
				healthError,
				healthSnapshot: healthData ?? loaderData.healthSnapshot ?? null,
				setupError,
				setupSnapshot,
			}),
		[
			hasPreloadBridge,
			healthData,
			healthError,
			loaderData.healthSnapshot,
			setupError,
			setupSnapshot,
		],
	);

	useEffect(() => {
		if (!currentSelection) {
			return;
		}

		const nextSelection = {
			projectId: currentSelection.project.id,
			workspaceId: currentSelection.workspace.id,
		};

		setLastWorkspaceSelection((currentSelection) =>
			currentSelection?.projectId === nextSelection.projectId &&
			currentSelection.workspaceId === nextSelection.workspaceId
				? currentSelection
				: nextSelection,
		);
		setLastWorkspaceNavigationRenderState((currentRenderState) =>
			currentRenderState?.selection.project.id ===
				currentSelection.project.id &&
			currentRenderState.selection.workspace.id ===
				currentSelection.workspace.id &&
			currentRenderState.projects === projects
				? currentRenderState
				: {
						projects,
						selection: currentSelection,
						source: 'current',
					},
		);
	}, [
		currentSelection,
		projects,
		setLastWorkspaceNavigationRenderState,
		setLastWorkspaceSelection,
	]);

	const resolveWorkspaceRouteSearch = useCallback(
		(workspace: WorkspaceShellModel): WorkbenchRouteSearch => ({
			dock: getPreferredDockTab({
				dockTabsByWorkspace,
				workspace,
			}),
			review: getPreferredReviewTab({
				reviewTabsByWorkspace,
				workspaceId: workspace.id,
			}),
		}),
		[dockTabsByWorkspace, reviewTabsByWorkspace],
	);
	const resolveWorkspaceChatId = useCallback(
		(workspace: WorkspaceShellModel) =>
			getPreferredChatId({ chatTabsByWorkspace, workspace }),
		[chatTabsByWorkspace],
	);
	const { renderStaticLink, renderWorkspaceLink } =
		useWorkbenchNavigationLinkRenderers({ resolveWorkspaceChatId });
	const navigateToStaticRoute = useCallback(
		(target: WorkbenchStaticNavigationTarget) => {
			navigate({ to: getWorkbenchStaticRoute(target) });
		},
		[navigate],
	);
	const navigateToWorkspace = useCallback(
		(nextProjectId: string, nextWorkspaceId: string) => {
			const target = findWorkspaceNavigationSelection(
				displayProjects,
				nextProjectId,
				nextWorkspaceId,
			);

			if (!target) {
				return;
			}

			navigate({
				params: {
					chatId: resolveWorkspaceChatId(target.workspace),
					projectId: target.project.id,
					workspaceId: target.workspace.id,
				},
				search: resolveWorkspaceRouteSearch(target.workspace),
				to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
			});
		},
		[
			displayProjects,
			navigate,
			resolveWorkspaceChatId,
			resolveWorkspaceRouteSearch,
		],
	);

	const addProjectMenu = useMemo(
		() =>
			buildAddProjectMenuModel({
				recents: recentProjects,
				setupSnapshot,
			}),
		[recentProjects, setupSnapshot],
	);
	// Add-project + recents handlers stay undefined until the local-open /
	// clone / quick-start flows land. The menu surface renders disabled entries
	// with a "Coming soon" reason in that state. When the action handlers ship,
	// they will write back via `useSetAtom(recentProjectsAtom)` to promote a
	// freshly opened project to the top of the list.
	const onSetupDiagnosticsRetry = useCallback(() => {
		if (hasPreloadBridge) {
			void refetchSetupDiagnostics();
		}
	}, [hasPreloadBridge, refetchSetupDiagnostics]);

	const model: WorkbenchLayoutModel = {
		activeProject: displaySelection?.project ?? null,
		activeWorkspace: displaySelection?.workspace ?? null,
		addProjectMenu,
		displayProjects,
		displaySelection,
		health: shellHealth,
		navigateToStaticRoute,
		navigateToWorkspace,
		resolveWorkspaceRouteSearch,
	};
	const navigation: NavigationContextValue = {
		renderStaticLink,
		renderWorkspaceLink,
	};
	const setupDiagnosticsValue: SetupDiagnosticsContextValue = {
		state: {
			setupDiagnostics: setupSnapshot,
			setupDiagnosticsError: setupError,
			isSetupDiagnosticsRetrying: isSetupDiagnosticsFetching,
		},
		actions: {
			onSetupDiagnosticsRetry,
		},
	};

	return {
		model,
		navigation,
		setupDiagnostics: setupDiagnosticsValue,
	};
}

/** Builds the TanStack Router link renderers passed via the navigation context. */
function useWorkbenchNavigationLinkRenderers({
	resolveWorkspaceChatId,
}: {
	resolveWorkspaceChatId: (workspace: WorkspaceShellModel) => string;
}) {
	const renderStaticLink = useCallback(renderStaticWorkbenchNavigationLink, []);
	const renderWorkspaceLink = useCallback(
		(
			target: WorkbenchWorkspaceNavigationLinkTarget,
			children: ReactElement,
		) => (
			<Link
				params={{
					chatId: resolveWorkspaceChatId(target.workspace),
					projectId: target.workspace.projectId,
					workspaceId: target.workspace.id,
				}}
				preload='intent'
				search={target.search}
				to='/projects/$projectId/workspaces/$workspaceId/chats/$chatId'
			>
				{children}
			</Link>
		),
		[resolveWorkspaceChatId],
	);

	return {
		renderStaticLink,
		renderWorkspaceLink,
	};
}

/** Wraps static-navigation children with an intent-preload `Link`. */
function renderStaticWorkbenchNavigationLink(
	target: WorkbenchStaticNavigationTarget,
	children: ReactElement,
) {
	return (
		<Link preload='intent' to={getWorkbenchStaticRoute(target)}>
			{children}
		</Link>
	);
}
