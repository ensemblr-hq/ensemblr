import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import {
	healthQuery,
	setupDiagnosticsQuery,
} from '@/renderer/api/ensemble-queries';
import { WorkbenchShell } from '@/renderer/components/workbench-shell';
import {
	DEFAULT_DOCK_TAB,
	DEFAULT_REVIEW_TAB,
	getComposerState,
} from '@/renderer/lib/workbench';
import {
	findProject,
	findSession,
	findWorkspace,
	getDefaultProject,
	getDefaultWorkspace,
	shellFixtureProjects,
} from '@/renderer/mocks/workbench';
import type { WorkbenchRouteSearch } from '@/renderer/types/workbench';
import type {
	WorkbenchDockActions,
	WorkbenchHealth,
} from '@/renderer/types/workbench-shell';

interface AppProps {
	projectId?: string;
	search?: WorkbenchRouteSearch;
	view?: 'dashboard' | 'history' | 'settings' | 'workspace';
	workspaceId?: string;
}

export function App({
	projectId,
	search,
	view = 'workspace',
	workspaceId,
}: AppProps) {
	const navigate = useNavigate();
	const health = useQuery(healthQuery);
	const setupDiagnostics = useQuery(setupDiagnosticsQuery);

	const activeProject = projectId
		? findProject(projectId)
		: getDefaultProject();
	const activeWorkspace = workspaceId
		? findWorkspace(activeProject, workspaceId)
		: getDefaultWorkspace();
	const activeSession = findSession(activeWorkspace, search?.chat);
	const activeReviewTab = search?.review ?? DEFAULT_REVIEW_TAB;
	const activeDockTab = search?.dock ?? DEFAULT_DOCK_TAB;
	const setupError = getErrorMessage(setupDiagnostics.error);
	const setupSnapshot = setupDiagnostics.data ?? null;

	const composer = getComposerState({
		activeSession,
		setupDiagnostics: setupSnapshot,
		setupError,
	});

	const shellHealth = useMemo<WorkbenchHealth>(() => {
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
	}, [health.data, health.error, setupError, setupSnapshot]);

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
		const nextProject = findProject(nextProjectId);
		const nextWorkspace = findWorkspace(nextProject, nextWorkspaceId);
		const nextSession = findSession(nextWorkspace);

		navigate({
			params: {
				projectId: nextProject.id,
				workspaceId: nextWorkspace.id,
			},
			search: {
				chat: nextSession.id,
				dock: DEFAULT_DOCK_TAB,
				review: DEFAULT_REVIEW_TAB,
			},
			to: '/projects/$projectId/workspaces/$workspaceId',
		});
	}

	function updateSearch(nextSearch: WorkbenchRouteSearch) {
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
			activeView={view}
			activeWorkspace={activeWorkspace}
			composer={composer}
			dockActions={dockActions}
			dockTabId={activeDockTab}
			health={shellHealth}
			onDockTabChange={(dock) => updateSearch({ dock })}
			onHistorySelect={() => navigate({ to: '/history' })}
			onReviewTabChange={(review) => updateSearch({ review })}
			onSessionTabChange={(chat) => updateSearch({ chat })}
			onSettingsSelect={() => navigate({ to: '/settings' })}
			onWorkspaceSelect={navigateToWorkspace}
			projects={shellFixtureProjects}
			setupDiagnostics={setupSnapshot}
			setupDiagnosticsError={setupError}
			isSetupDiagnosticsRetrying={setupDiagnostics.isFetching}
			onSetupDiagnosticsRetry={() => {
				void setupDiagnostics.refetch();
			}}
		/>
	);
}

function getErrorMessage(error: unknown): string | null {
	if (!error) {
		return null;
	}

	return error instanceof Error
		? error.message
		: 'Unknown renderer query error';
}
