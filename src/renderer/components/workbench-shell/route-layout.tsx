import {
	keepPreviousData,
	useQuery,
	useQueryClient,
} from '@tanstack/react-query';
import {
	getRouteApi,
	Link,
	Outlet,
	useChildMatches,
	useNavigate,
} from '@tanstack/react-router';
import { useAtom, useAtomValue } from 'jotai';
import {
	createContext,
	type ReactElement,
	use,
	useCallback,
	useEffect,
	useMemo,
} from 'react';

import {
	healthQuery,
	isEnsembleApiAvailable,
	repositoryWorkspaceNavigationQuery,
	setupDiagnosticsQuery,
} from '@/renderer/api/ensemble-queries';
import { WorkbenchEmptyStateContent } from '@/renderer/components/workbench-empty-state';
import {
	WorkbenchFrame,
	type WorkspaceMainContentState,
	WorkspaceWorkbenchContent,
} from '@/renderer/components/workbench-shell';
import { WorkspaceConversationContent } from '@/renderer/components/workbench-shell/panel-layout';
import { useRouteProfilerMount } from '@/renderer/lib/instrumentation/route-profiler';
import {
	buildAddProjectMenuModel,
	findWorkspaceNavigationSelection,
	getComposerState,
	getEmptyStateCopy,
	getErrorMessage,
	getPreferredSession,
	getRenderableNavigationSnapshot,
	getWorkbenchHealth,
	getWorkbenchStaticRoute,
	isWorkbenchActiveView,
	mapRepositoriesToProjects,
	resolveWorkspaceNavigationRenderState,
	resolveWorkspaceNavigationSelection,
	type WorkspaceNavigationSelection,
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
	useWorkspacePanelTabState,
} from '@/renderer/state/workspace';
import type {
	AddProjectMenuModel,
	DockTabId,
	ProjectShellModel,
	WorkbenchRouteSearch,
	WorkbenchShellData,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type {
	WorkbenchActiveView,
	WorkbenchDockActions,
	WorkbenchHealth,
	WorkbenchStaticNavigationTarget,
	WorkbenchWorkspaceNavigationLinkTarget,
} from '@/renderer/types/workbench-shell';
import type { RepositoryWorkspaceNavigationSnapshot } from '@/shared/ipc';

interface WorkbenchShellRouteState {
	routeProjectId?: string;
	routeWorkspaceId?: string;
	view: WorkbenchActiveView;
}

interface WorkbenchChildMatch {
	params: Record<string, unknown>;
	view: unknown;
}

interface WorkbenchLayoutModel {
	activeProject: ProjectShellModel | null;
	activeWorkspace: WorkspaceShellModel | null;
	addProjectMenu: AddProjectMenuModel;
	displayProjects: ProjectShellModel[];
	displaySelection: WorkspaceNavigationSelection | null;
	health: WorkbenchHealth;
	navigateToStaticRoute: (target: WorkbenchStaticNavigationTarget) => void;
	isSetupDiagnosticsRetrying: boolean;
	navigateToWorkspace: (projectId: string, workspaceId: string) => void;
	onSetupDiagnosticsRetry: () => void;
	renderStaticNavigationLink: (
		target: WorkbenchStaticNavigationTarget,
		children: ReactElement,
	) => ReactElement;
	renderWorkspaceNavigationLink: (
		target: WorkbenchWorkspaceNavigationLinkTarget,
		children: ReactElement,
	) => ReactElement;
	resolveWorkspaceRouteSearch: (
		workspace: WorkspaceShellModel,
	) => WorkbenchRouteSearch;
	setupDiagnostics: WorkbenchShellData['setupSnapshot'];
	setupDiagnosticsError: string | null;
}

const workbenchRouteApi = getRouteApi('/_workbench');
const workspaceRouteApi = getRouteApi(
	'/_workbench/_shell/projects/$projectId/workspaces/$workspaceId',
);
const WorkbenchLayoutModelContext = createContext<WorkbenchLayoutModel | null>(
	null,
);
const WorkspaceMainContentContext =
	createContext<WorkspaceMainContentState | null>(null);

/** Workbench shell layout — builds the layout model and renders the navigation frame. */
export function WorkbenchShellLayout() {
	useRouteProfilerMount('WorkbenchShellLayout');

	const loaderData = workbenchRouteApi.useLoaderData();
	const routeState = useWorkbenchShellRouteState();
	const model = useWorkbenchLayoutModel({ loaderData, routeState });

	return (
		<WorkbenchFrame
			activeProject={model.activeProject}
			activeView={routeState.view}
			activeWorkspace={model.activeWorkspace}
			addProjectMenu={model.addProjectMenu}
			health={model.health}
			onStaticNavigationSelect={model.navigateToStaticRoute}
			onWorkspaceSelect={model.navigateToWorkspace}
			projects={model.displayProjects}
			resolveWorkspaceRouteSearch={model.resolveWorkspaceRouteSearch}
			renderStaticNavigationLink={model.renderStaticNavigationLink}
			renderWorkspaceNavigationLink={model.renderWorkspaceNavigationLink}
		>
			<WorkbenchLayoutModelContext.Provider value={model}>
				<Outlet />
			</WorkbenchLayoutModelContext.Provider>
		</WorkbenchFrame>
	);
}

/** Placeholder content for dashboard/history/help/settings views. */
export function WorkbenchPlaceholderPage({
	view,
}: {
	view: Exclude<WorkbenchActiveView, 'workspace'>;
}) {
	const model = useWorkbenchLayoutRouteModel();

	return (
		<WorkbenchEmptyStateContent
			emptyState={getWorkbenchPlaceholderCopy({
				projectCount: model.displayProjects.length,
				setupStatus: model.setupDiagnostics?.status,
				view,
			})}
		/>
	);
}

/** Layout route for `/projects/:projectId/workspaces/:workspaceId`. */
export function WorkspaceWorkbenchLayout() {
	useRouteProfilerMount('WorkspaceWorkbenchLayout');

	const model = useWorkbenchLayoutRouteModel();
	const params = workspaceRouteApi.useParams();
	const search = workspaceRouteApi.useSearch();
	const chatId = useActiveWorkspaceChatId();
	const selection =
		findWorkspaceNavigationSelection(
			model.displayProjects,
			params.projectId,
			params.workspaceId,
		) ?? model.displaySelection;

	if (!selection) {
		return (
			<WorkbenchEmptyStateContent
				emptyState={getEmptyStateCopy({
					isLoading: false,
					navigationError: null,
					projectCount: model.displayProjects.length,
					setupStatus: model.setupDiagnostics?.status,
				})}
			/>
		);
	}

	return (
		<WorkspaceRouteContent
			chatId={chatId}
			model={model}
			search={search}
			selection={selection}
		/>
	);
}

/** Chat-route content — renders the workspace conversation surface. */
export function WorkspaceChatPage() {
	const mainContent = use(WorkspaceMainContentContext);

	if (!mainContent) {
		throw new Error(
			'Workspace chat page is only available below workspace route.',
		);
	}

	return <WorkspaceConversationContent {...mainContent} />;
}

/** Sentinel route component used while the chat redirect resolves. */
export function WorkspaceNoChatPage() {
	return null;
}

/** Workspace shell content — wires panel tabs, composer state, and navigation. */
function WorkspaceRouteContent({
	chatId,
	model,
	search,
	selection,
}: {
	chatId?: string;
	model: WorkbenchLayoutModel;
	search: WorkbenchRouteSearch;
	selection: WorkspaceNavigationSelection;
}) {
	const navigate = useNavigate();
	const activeProject = selection.project;
	const activeWorkspace = selection.workspace;
	const activeSession = getPreferredSession(activeWorkspace, chatId);
	const panelTabs = useWorkspacePanelTabState({
		activeChatId: activeSession.id,
		activeWorkspace,
		search,
	});
	const activeReviewTab = panelTabs.activeReviewTab;
	const activeDockTab = panelTabs.activeDockTab;
	const composer = getComposerState({
		activeSession,
		setupDiagnostics: model.setupDiagnostics,
		setupError: model.setupDiagnosticsError,
	});
	const dockActions = useMemo<WorkbenchDockActions>(
		() => ({
			onNewTerminal: () => undefined,
			onOpenRunPort: () => undefined,
			onOpenSetupScripts: () => undefined,
			onRunScript: () => undefined,
			onRunSetupScript: () => undefined,
			onStopRunScript: () => undefined,
		}),
		[],
	);

	/** Navigates to the canonical chat route, preserving existing search state. */
	function navigateToWorkspaceChat({
		nextChatId,
		nextSearch,
	}: {
		nextChatId: string;
		nextSearch?: WorkbenchRouteSearch;
	}) {
		navigate({
			params: {
				chatId: nextChatId,
				projectId: activeProject.id,
				workspaceId: activeWorkspace.id,
			},
			search: {
				dock: activeDockTab,
				review: activeReviewTab,
				...nextSearch,
			},
			to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
		});
	}

	/** Persists tab changes to local prefs and forwards them to the URL. */
	function updateSearch(nextSearch: WorkbenchRouteSearch) {
		if (nextSearch.review) {
			panelTabs.setWorkspaceReviewTab(activeWorkspace.id, nextSearch.review);
		}
		if (nextSearch.dock) {
			panelTabs.setWorkspaceDockTab(activeWorkspace.id, nextSearch.dock);
		}

		navigateToWorkspaceChat({
			nextChatId: activeSession.id,
			nextSearch,
		});
	}

	return (
		<WorkspaceWorkbenchContent
			activeProject={activeProject}
			activeReviewTab={activeReviewTab}
			activeSession={activeSession}
			activeWorkspace={activeWorkspace}
			composer={composer}
			dockActions={dockActions}
			dockTabId={activeDockTab}
			onDockTabChange={(dock: DockTabId) => updateSearch({ dock })}
			onReviewTabChange={(review) => updateSearch({ review })}
			onSessionTabChange={(nextChatId) =>
				navigateToWorkspaceChat({ nextChatId })
			}
			setupDiagnostics={model.setupDiagnostics}
			setupDiagnosticsError={model.setupDiagnosticsError}
			isSetupDiagnosticsRetrying={model.isSetupDiagnosticsRetrying}
			onSetupDiagnosticsRetry={model.onSetupDiagnosticsRetry}
			MainContent={WorkspaceMainContentOutlet}
		/>
	);
}

/** Provides workspace main-content state to the nested chat route via context. */
function WorkspaceMainContentOutlet(state: WorkspaceMainContentState) {
	return (
		<WorkspaceMainContentContext.Provider value={state}>
			<Outlet />
		</WorkspaceMainContentContext.Provider>
	);
}

/** Consumes the workbench layout model context; throws when used outside `_shell`. */
function useWorkbenchLayoutRouteModel() {
	const model = use(WorkbenchLayoutModelContext);

	if (!model) {
		throw new Error('Workbench layout model is only available below _shell.');
	}

	return model;
}

/**
 * Builds the workbench layout model — combining loader data, live queries,
 * persisted prefs, and navigation handlers — for descendant routes.
 */
function useWorkbenchLayoutModel({
	loaderData,
	routeState,
}: {
	loaderData: WorkbenchShellData;
	routeState: WorkbenchShellRouteState;
}): WorkbenchLayoutModel {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const hasPreloadBridge = isEnsembleApiAvailable();
	const health = useQuery({
		...healthQuery,
		enabled: hasPreloadBridge,
	});
	const repositoryWorkspaceNavigation = useQuery({
		...repositoryWorkspaceNavigationQuery,
		enabled: hasPreloadBridge,
		placeholderData: keepPreviousData,
	});
	const setupDiagnostics = useQuery({
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
		getErrorMessage(setupDiagnostics.error) ?? loaderData.setupError;
	const setupSnapshot =
		setupDiagnostics.data ?? loaderData.setupSnapshot ?? null;
	const cachedNavigationSnapshot =
		queryClient.getQueryData<RepositoryWorkspaceNavigationSnapshot>(
			repositoryWorkspaceNavigationQuery.queryKey,
		);
	const navigationSnapshot = getRenderableNavigationSnapshot({
		cachedSnapshot: cachedNavigationSnapshot,
		querySnapshot:
			repositoryWorkspaceNavigation.data ??
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
					(repositoryWorkspaceNavigation.isLoading ||
						repositoryWorkspaceNavigation.isFetching ||
						repositoryWorkspaceNavigation.isPlaceholderData ||
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
			repositoryWorkspaceNavigation.isFetching,
			repositoryWorkspaceNavigation.isLoading,
			repositoryWorkspaceNavigation.isPlaceholderData,
			routeState.routeProjectId,
			routeState.routeWorkspaceId,
		],
	);
	const displayProjects = navigationRenderState?.projects ?? projects;
	const displaySelection = navigationRenderState?.selection ?? null;
	const healthError =
		getErrorMessage(health.error) ?? loaderData.healthError ?? null;
	const shellHealth = useMemo<WorkbenchHealth>(
		() =>
			getWorkbenchHealth({
				hasPreloadBridge,
				healthError,
				healthSnapshot: health.data ?? loaderData.healthSnapshot ?? null,
				setupError,
				setupSnapshot,
			}),
		[
			hasPreloadBridge,
			health.data,
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
	const { renderStaticNavigationLink, renderWorkspaceNavigationLink } =
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
			void setupDiagnostics.refetch();
		}
	}, [hasPreloadBridge, setupDiagnostics.refetch]);

	return {
		activeProject: displaySelection?.project ?? null,
		activeWorkspace: displaySelection?.workspace ?? null,
		addProjectMenu,
		displayProjects,
		displaySelection,
		health: shellHealth,
		isSetupDiagnosticsRetrying: setupDiagnostics.isFetching,
		navigateToStaticRoute,
		navigateToWorkspace,
		onSetupDiagnosticsRetry,
		renderStaticNavigationLink,
		renderWorkspaceNavigationLink,
		resolveWorkspaceRouteSearch,
		setupDiagnostics: setupSnapshot,
		setupDiagnosticsError: setupError,
	};
}

/** Derives the active workbench view + URL params from the current router match. */
function useWorkbenchShellRouteState(): WorkbenchShellRouteState {
	const childMatches = useChildMatches({
		select: (matches): WorkbenchChildMatch[] =>
			matches.map((match) => ({
				params: match.params as unknown as Record<string, unknown>,
				view: getWorkbenchStaticView(match.staticData),
			})),
	});
	const viewMatch = [...childMatches]
		.reverse()
		.find((match) => isWorkbenchActiveView(match.view));
	const view = isWorkbenchActiveView(viewMatch?.view)
		? viewMatch.view
		: 'dashboard';

	if (view !== 'workspace') {
		return { view };
	}

	const workspaceMatch = [...childMatches]
		.reverse()
		.find(
			(match) =>
				getStringRouteParam(match.params, 'projectId') &&
				getStringRouteParam(match.params, 'workspaceId'),
		);

	return {
		routeProjectId: getStringRouteParam(workspaceMatch?.params, 'projectId'),
		routeWorkspaceId: getStringRouteParam(
			workspaceMatch?.params,
			'workspaceId',
		),
		view,
	};
}

/** Extracts the `$chatId` URL param when the active route exposes it. */
function useActiveWorkspaceChatId() {
	const childMatches = useChildMatches({
		select: (matches): Array<Record<string, unknown>> =>
			matches.map(
				(match) => match.params as unknown as Record<string, unknown>,
			),
	});
	const chatMatch = [...childMatches]
		.reverse()
		.find((params) => getStringRouteParam(params, 'chatId'));

	return getStringRouteParam(chatMatch, 'chatId');
}

/** Builds the TanStack Router link renderers passed to the navigation sidebar. */
function useWorkbenchNavigationLinkRenderers({
	resolveWorkspaceChatId,
}: {
	resolveWorkspaceChatId: (workspace: WorkspaceShellModel) => string;
}) {
	const renderStaticNavigationLink = useCallback(
		renderStaticWorkbenchNavigationLink,
		[],
	);
	const renderWorkspaceNavigationLink = useCallback(
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
		renderStaticNavigationLink,
		renderWorkspaceNavigationLink,
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

/** Picks placeholder title + detail copy for non-workspace workbench views. */
function getWorkbenchPlaceholderCopy({
	projectCount,
	setupStatus,
	view,
}: {
	projectCount: number;
	setupStatus?: string;
	view: Exclude<WorkbenchActiveView, 'workspace'>;
}) {
	if (setupStatus !== 'ready') {
		return getEmptyStateCopy({
			isLoading: false,
			navigationError: null,
			projectCount,
			setupStatus,
		});
	}

	switch (view) {
		case 'history':
			return {
				detail: 'Session history is not connected yet.',
				title: 'History',
			};
		case 'help':
			return {
				detail: 'Help content is not connected yet.',
				title: 'Help',
			};
		case 'settings':
			return {
				detail: 'Settings are available from the settings route.',
				title: 'Settings',
			};
		case 'dashboard':
			return {
				detail: 'Workspace overview is not connected yet.',
				title: 'Dashboard',
			};
	}
}

/** Safely extracts a string route param from a router match. */
function getStringRouteParam(
	params: Record<string, unknown> | undefined,
	key: string,
) {
	const value = params?.[key];

	return typeof value === 'string' ? value : undefined;
}

/** Extracts the `workbenchView` value from a route's `staticData` payload. */
function getWorkbenchStaticView(staticData: unknown) {
	if (typeof staticData !== 'object' || staticData === null) {
		return undefined;
	}

	return 'workbenchView' in staticData ? staticData.workbenchView : undefined;
}
