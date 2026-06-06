import {
	keepPreviousData,
	useQuery,
	useQueryClient,
} from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useAtom } from 'jotai';
import { useEffect, useMemo } from 'react';
import {
	healthQuery,
	isEnsembleApiAvailable,
	repositoryWorkspaceNavigationQuery,
	setupDiagnosticsQuery,
} from '@/renderer/api/ensemble-queries';
import { WorkbenchEmptyStateShell } from '@/renderer/components/workbench-empty-state';
import { WorkbenchShell } from '@/renderer/components/workbench-shell';
import {
	findWorkspaceNavigationSelection,
	getComposerState,
	getPreferredSession,
	getRenderableNavigationSnapshot,
	mapRepositoriesToProjects,
	resolveWorkspaceNavigationRenderState,
	resolveWorkspaceNavigationSelection,
	resolveWorkspaceRouteParams,
	type WorkspaceNavigationSelection,
} from '@/renderer/lib/workbench';
import { shellFixtureProjects } from '@/renderer/mocks/workbench';
import {
	lastWorkspaceNavigationRenderStateAtom,
	lastWorkspaceSelectionAtom,
	useWorkspacePanelTabState,
} from '@/renderer/state/workspace';
import type {
	ProjectShellModel,
	WorkbenchRouteSearch,
} from '@/renderer/types/workbench';
import type {
	WorkbenchDockActions,
	WorkbenchHealth,
} from '@/renderer/types/workbench-shell';
import type {
	RepositoryWorkspaceNavigationSnapshot,
	SetupDiagnosticsSnapshot,
} from '@/shared/ipc';

interface AppProps {
	projectId?: string;
	search?: WorkbenchRouteSearch;
	view?: 'dashboard' | 'help' | 'history' | 'settings' | 'workspace';
	workspaceId?: string;
}

export function App({
	projectId,
	search,
	view = 'workspace',
	workspaceId,
}: AppProps) {
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
	const setupError = getErrorMessage(setupDiagnostics.error);
	const setupSnapshot = setupDiagnostics.data ?? null;
	const cachedNavigationSnapshot =
		queryClient.getQueryData<RepositoryWorkspaceNavigationSnapshot>(
			repositoryWorkspaceNavigationQuery.queryKey,
		);
	const navigationSnapshot = getRenderableNavigationSnapshot({
		cachedSnapshot: cachedNavigationSnapshot,
		querySnapshot: repositoryWorkspaceNavigation.data,
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
				routeProjectId: projectId,
				routeWorkspaceId: workspaceId,
				storedSelection: lastWorkspaceSelection,
			}),
		[projectId, projects, lastWorkspaceSelection, workspaceId],
	);
	const fallbackSelection = useMemo(
		() =>
			resolveWorkspaceNavigationSelection({
				projects,
				storedSelection: lastWorkspaceSelection,
			}),
		[lastWorkspaceSelection, projects],
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
				routeProjectId: projectId,
				routeWorkspaceId: workspaceId,
				selection: currentSelection,
			}),
		[
			currentSelection,
			hasPreloadBridge,
			lastWorkspaceNavigationRenderState,
			navigationSnapshot,
			projects,
			projectId,
			repositoryWorkspaceNavigation.isFetching,
			repositoryWorkspaceNavigation.isLoading,
			repositoryWorkspaceNavigation.isPlaceholderData,
			workspaceId,
		],
	);
	const displayProjects = navigationRenderState?.projects ?? projects;
	const displaySelection = navigationRenderState?.selection ?? null;
	const isNavigationSettled =
		hasPreloadBridge &&
		Boolean(navigationSnapshot) &&
		!repositoryWorkspaceNavigation.isLoading &&
		!repositoryWorkspaceNavigation.isFetching &&
		!repositoryWorkspaceNavigation.isPlaceholderData;

	const shellHealth = useMemo<WorkbenchHealth>(() => {
		if (!hasPreloadBridge) {
			return {
				detail: 'Electron preload bridge is unavailable in this context.',
				label: 'IPC unavailable',
				state: 'unavailable',
			};
		}

		const snapshot = health.data;

		if (snapshot) {
			if (snapshot.database.status === 'error') {
				return {
					detail: snapshot.database.error ?? 'Database failed to open.',
					label: `${snapshot.appName} database unavailable`,
					state: 'unavailable',
				};
			}

			if (snapshot.config.blocksReadiness) {
				return {
					detail:
						snapshot.config.diagnostics[0]?.message ??
						'Declarative config blocks readiness.',
					label: `${snapshot.appName} config requires attention`,
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
					state:
						setupSnapshot.status === 'checking' ? 'pending' : 'unavailable',
				};
			}

			return {
				detail: `Electron ${snapshot.versions.electron} on ${snapshot.platform}. Database schema v${snapshot.database.schemaVersion}.`,
				label: `${snapshot.appName} IPC online`,
				state: 'online',
			};
		}

		const error = getErrorMessage(health.error);

		if (error) {
			return {
				detail: error,
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
	}, [hasPreloadBridge, health.data, health.error, setupError, setupSnapshot]);

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

	useEffect(() => {
		if (view !== 'workspace' || !projectId || !workspaceId) {
			return;
		}

		if (currentSelection || !isNavigationSettled || !fallbackSelection) {
			return;
		}

		navigate({
			params: {
				projectId: fallbackSelection.project.id,
				workspaceId: fallbackSelection.workspace.id,
			},
			replace: true,
			search: {
				chat: getPreferredSession(fallbackSelection.workspace).id,
			},
			to: '/projects/$projectId/workspaces/$workspaceId',
		});
	}, [
		currentSelection,
		fallbackSelection,
		isNavigationSettled,
		navigate,
		projectId,
		view,
		workspaceId,
	]);

	useEffect(() => {
		if (view !== 'workspace' || !currentSelection) {
			return;
		}

		const activeSession = getPreferredSession(
			currentSelection.workspace,
			search?.chat,
		);

		if (search?.chat === activeSession.id) {
			return;
		}

		navigate({
			params: {
				projectId: currentSelection.project.id,
				workspaceId: currentSelection.workspace.id,
			},
			replace: true,
			search: {
				chat: activeSession.id,
				dock: search?.dock,
				review: search?.review,
			},
			to: '/projects/$projectId/workspaces/$workspaceId',
		});
	}, [currentSelection, navigate, search, view]);

	const onDashboardSelect = () => navigate({ to: '/' });
	const onHelpSelect = () => navigate({ to: '/help' });
	const onHistorySelect = () => navigate({ to: '/history' });
	const onSettingsSelect = () => navigate({ to: '/settings' });
	const onEmptyStateWorkspaceSelect = (
		nextProjectId: string,
		nextWorkspaceId: string,
	) => {
		const target = resolveWorkspaceRouteParams(
			displayProjects,
			nextProjectId,
			nextWorkspaceId,
		);

		if (!target) {
			return;
		}

		navigate({
			params: {
				projectId: target.projectId,
				workspaceId: target.workspaceId,
			},
			search: {
				chat: target.chat,
			},
			to: '/projects/$projectId/workspaces/$workspaceId',
		});
	};

	if (!displaySelection) {
		return (
			<WorkbenchEmptyStateShell
				activeView={view}
				emptyState={getEmptyStateCopy({
					isLoading:
						!navigationSnapshot && repositoryWorkspaceNavigation.isLoading,
					navigationError: navigationSnapshot
						? null
						: getErrorMessage(repositoryWorkspaceNavigation.error),
					projectCount: projects.length,
					setupStatus: setupSnapshot?.status,
				})}
				health={shellHealth}
				onDashboardSelect={onDashboardSelect}
				onHelpSelect={onHelpSelect}
				onHistorySelect={onHistorySelect}
				onSettingsSelect={onSettingsSelect}
				onWorkspaceSelect={onEmptyStateWorkspaceSelect}
				projects={displayProjects}
			/>
		);
	}

	return (
		<WorkspaceAppShell
			activeView={view}
			health={shellHealth}
			onDashboardSelect={onDashboardSelect}
			onHelpSelect={onHelpSelect}
			onHistorySelect={onHistorySelect}
			onSettingsSelect={onSettingsSelect}
			projects={displayProjects}
			search={search}
			selection={displaySelection}
			setupDiagnostics={setupSnapshot}
			setupDiagnosticsError={setupError}
			isSetupDiagnosticsRetrying={setupDiagnostics.isFetching}
			onSetupDiagnosticsRetry={() => {
				if (hasPreloadBridge) {
					void setupDiagnostics.refetch();
				}
			}}
		/>
	);
}

function WorkspaceAppShell({
	activeView,
	health,
	onDashboardSelect,
	onHelpSelect,
	onHistorySelect,
	onSettingsSelect,
	projects,
	search,
	selection,
	setupDiagnostics,
	setupDiagnosticsError,
	isSetupDiagnosticsRetrying,
	onSetupDiagnosticsRetry,
}: {
	activeView: NonNullable<AppProps['view']>;
	health: WorkbenchHealth;
	onDashboardSelect: () => void;
	onHelpSelect: () => void;
	onHistorySelect: () => void;
	onSettingsSelect: () => void;
	projects: ProjectShellModel[];
	search?: WorkbenchRouteSearch;
	selection: WorkspaceNavigationSelection;
	setupDiagnostics: SetupDiagnosticsSnapshot | null;
	setupDiagnosticsError: string | null;
	isSetupDiagnosticsRetrying: boolean;
	onSetupDiagnosticsRetry: () => void;
}) {
	const navigate = useNavigate();
	const activeProject = selection.project;
	const activeWorkspace = selection.workspace;
	const activeSession = getPreferredSession(activeWorkspace, search?.chat);
	const panelTabs = useWorkspacePanelTabState({
		activeWorkspace,
		search,
	});
	const activeReviewTab = panelTabs.activeReviewTab;
	const activeDockTab = panelTabs.activeDockTab;
	const composer = getComposerState({
		activeSession,
		setupDiagnostics,
		setupError: setupDiagnosticsError,
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

	function navigateToWorkspace(nextProjectId: string, nextWorkspaceId: string) {
		const nextSelection = findWorkspaceNavigationSelection(
			projects,
			nextProjectId,
			nextWorkspaceId,
		);

		if (!nextSelection) {
			return;
		}

		const nextSession = getPreferredSession(nextSelection.workspace);
		const preferredTabs = panelTabs.getPreferredTabsForWorkspace(
			nextSelection.workspace,
		);

		navigate({
			params: {
				projectId: nextSelection.project.id,
				workspaceId: nextSelection.workspace.id,
			},
			search: {
				chat: nextSession.id,
				dock: preferredTabs.dock,
				review: preferredTabs.review,
			},
			to: '/projects/$projectId/workspaces/$workspaceId',
		});
	}

	function updateSearch(nextSearch: WorkbenchRouteSearch) {
		if (nextSearch.review) {
			panelTabs.setWorkspaceReviewTab(activeWorkspace.id, nextSearch.review);
		}
		if (nextSearch.dock) {
			panelTabs.setWorkspaceDockTab(activeWorkspace.id, nextSearch.dock);
		}

		navigate({
			params: {
				projectId: activeProject.id,
				workspaceId: activeWorkspace.id,
			},
			search: {
				chat: activeSession.id,
				dock: activeDockTab,
				review: activeReviewTab,
				...nextSearch,
			},
			to: '/projects/$projectId/workspaces/$workspaceId',
		});
	}

	return (
		<WorkbenchShell
			activeProject={activeProject}
			activeReviewTab={activeReviewTab}
			activeSession={activeSession}
			activeView={activeView ?? 'workspace'}
			activeWorkspace={activeWorkspace}
			composer={composer}
			dockActions={dockActions}
			dockTabId={activeDockTab}
			health={health}
			onDashboardSelect={onDashboardSelect}
			onDockTabChange={(dock) => updateSearch({ dock })}
			onHelpSelect={onHelpSelect}
			onHistorySelect={onHistorySelect}
			onReviewTabChange={(review) => updateSearch({ review })}
			onSessionTabChange={(chat) => updateSearch({ chat })}
			onSettingsSelect={onSettingsSelect}
			onWorkspaceSelect={navigateToWorkspace}
			projects={projects}
			setupDiagnostics={setupDiagnostics}
			setupDiagnosticsError={setupDiagnosticsError}
			isSetupDiagnosticsRetrying={isSetupDiagnosticsRetrying}
			onSetupDiagnosticsRetry={onSetupDiagnosticsRetry}
		/>
	);
}

function getEmptyStateCopy({
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

function getErrorMessage(error: unknown): string | null {
	if (!error) {
		return null;
	}

	return error instanceof Error
		? error.message
		: 'Unknown renderer query error';
}
