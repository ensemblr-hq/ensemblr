import type {
	ProjectShellModel,
	SessionTabModel,
	StoredWorkspaceSelection,
	WorkspaceNavigationRenderState,
	WorkspaceNavigationSelection,
	WorkspaceRouteParams,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';

import { createPlaceholderSession } from './navigation-model';

/**
 * Picks the active workspace selection, preferring the URL route, then the
 * stored selection, then the first available workspace.
 */
export function resolveWorkspaceNavigationSelection({
	projects,
	routeProjectId,
	routeWorkspaceId,
	storedSelection,
}: {
	projects: ProjectShellModel[];
	routeProjectId?: string;
	routeWorkspaceId?: string;
	storedSelection?: StoredWorkspaceSelection | null;
}): WorkspaceNavigationSelection | null {
	if (routeProjectId && routeWorkspaceId) {
		return findWorkspaceNavigationSelection(
			projects,
			routeProjectId,
			routeWorkspaceId,
			'route',
		);
	}

	const storedWorkspaceSelection = storedSelection
		? findWorkspaceNavigationSelection(
				projects,
				storedSelection.projectId,
				storedSelection.workspaceId,
				'stored',
			)
		: null;

	return storedWorkspaceSelection ?? getFirstWorkspaceSelection(projects);
}

/**
 * Computes the render state, falling back to the previous snapshot when the
 * fresh selection is unavailable but a valid previous one exists.
 */
export function resolveWorkspaceNavigationRenderState({
	canUsePreviousState,
	previousState,
	projects,
	routeProjectId,
	routeWorkspaceId,
	selection,
}: {
	canUsePreviousState: boolean;
	previousState?: WorkspaceNavigationRenderState | null;
	projects: ProjectShellModel[];
	routeProjectId?: string;
	routeWorkspaceId?: string;
	selection: WorkspaceNavigationSelection | null;
}): WorkspaceNavigationRenderState | null {
	if (selection) {
		return {
			projects,
			selection,
			source: 'current',
		};
	}

	if (canUsePreviousState && previousState) {
		if (routeProjectId && routeWorkspaceId) {
			const previousRouteSelection = findWorkspaceNavigationSelection(
				previousState.projects,
				routeProjectId,
				routeWorkspaceId,
				'route',
			);

			if (previousRouteSelection) {
				return {
					projects: previousState.projects,
					selection: previousRouteSelection,
					source: 'previous',
				};
			}

			if (
				previousState.selection.project.id !== routeProjectId ||
				previousState.selection.workspace.id !== routeWorkspaceId
			) {
				return null;
			}
		}

		return {
			...previousState,
			source: 'previous',
		};
	}

	return null;
}

/** Looks up a (project, workspace) selection by id pair. */
export function findWorkspaceNavigationSelection(
	projects: ProjectShellModel[],
	projectId: string,
	workspaceId: string,
	source: WorkspaceNavigationSelection['source'] = 'route',
): WorkspaceNavigationSelection | null {
	const project = projects.find((candidate) => candidate.id === projectId);
	const workspace = project?.workspaces.find(
		(candidate) => candidate.id === workspaceId,
	);

	return project && workspace
		? {
				project,
				source,
				workspace,
			}
		: null;
}

/**
 * Picks the session to surface for a workspace, preferring an explicit id and
 * falling back to the first session or a placeholder.
 */
export function getPreferredSession(
	workspace: WorkspaceShellModel,
	sessionId?: string,
): SessionTabModel {
	return (
		workspace.sessions.find((session) => session.id === sessionId) ??
		workspace.sessions[0] ??
		createPlaceholderSession(workspace)
	);
}

/**
 * Resolves a (project, workspace) target into the matching route params,
 * including a preferred chat id.
 */
export function resolveWorkspaceRouteParams(
	projects: ProjectShellModel[],
	projectId: string,
	workspaceId: string,
): WorkspaceRouteParams | null {
	const selection = findWorkspaceNavigationSelection(
		projects,
		projectId,
		workspaceId,
	);

	if (!selection) {
		return null;
	}

	return {
		chatId: getPreferredSession(selection.workspace).id,
		projectId: selection.project.id,
		workspaceId: selection.workspace.id,
	};
}

/** Returns the first available (project, workspace) pair as a selection. */
function getFirstWorkspaceSelection(
	projects: ProjectShellModel[],
): WorkspaceNavigationSelection | null {
	for (const project of projects) {
		const workspace = project.workspaces[0];

		if (workspace) {
			return {
				project,
				source: 'first',
				workspace,
			};
		}
	}

	return null;
}
