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
 * Whether a workspace can be navigated to right now. A workspace still being
 * created has no worktree yet, and one being archived is losing the one it had,
 * so neither is a place to land — an id in `unavailableWorkspaceIds` is refused
 * the same way, which is what stops a hop away from an archiving workspace from
 * redirecting straight back into it.
 * @param workspace - The candidate workspace
 * @param unavailableWorkspaceIds - Ids the caller knows are mid-teardown
 * @returns True when the workspace can be opened
 */
function isSelectableWorkspace(
	workspace: WorkspaceShellModel,
	unavailableWorkspaceIds: ReadonlySet<string> | undefined,
): boolean {
	return (
		!workspace.isPendingCreation &&
		unavailableWorkspaceIds?.has(workspace.id) !== true
	);
}

/**
 * Picks the active workspace selection, preferring the URL route, then the
 * stored workspace, then the first workspace in the stored project.
 *
 * A stored selection is a hard project boundary: once the user has been
 * somewhere, emptying or removing that project holds on Welcome rather than
 * dropping them into an unrelated project. The first-available-anywhere
 * fallback is therefore reserved for a launch with nothing stored yet.
 */
export function resolveWorkspaceNavigationSelection({
	projects,
	routeProjectId,
	routeWorkspaceId,
	storedSelection,
	unavailableWorkspaceIds,
}: {
	projects: ProjectShellModel[];
	routeProjectId?: string;
	routeWorkspaceId?: string;
	storedSelection?: StoredWorkspaceSelection | null;
	/** Workspaces mid-teardown, refused as a target however they were reached. */
	unavailableWorkspaceIds?: ReadonlySet<string>;
}): WorkspaceNavigationSelection | null {
	if (routeProjectId && routeWorkspaceId) {
		return findWorkspaceNavigationSelection(
			projects,
			routeProjectId,
			routeWorkspaceId,
			'route',
			unavailableWorkspaceIds,
		);
	}

	if (storedSelection) {
		return (
			findWorkspaceNavigationSelection(
				projects,
				storedSelection.projectId,
				storedSelection.workspaceId,
				'stored',
				unavailableWorkspaceIds,
			) ??
			getFirstWorkspaceSelectionInProject(
				projects,
				storedSelection.projectId,
				unavailableWorkspaceIds,
			)
		);
	}

	return getFirstWorkspaceSelection(projects, unavailableWorkspaceIds);
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
	unavailableWorkspaceIds?: ReadonlySet<string>,
): WorkspaceNavigationSelection | null {
	const project = projects.find((candidate) => candidate.id === projectId);
	const workspace = project?.workspaces.find(
		(candidate) =>
			candidate.id === workspaceId &&
			isSelectableWorkspace(candidate, unavailableWorkspaceIds),
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
 * Locates a workspace by its id alone, scanning every project. An unread mark
 * records the workspace an agent spoke in but never the project above it, so
 * jumping to one has to recover the pair before it can build a route.
 *
 * Answers whether the tree *holds* the workspace rather than whether it can be
 * opened right now, because two of its callers ask only that — the jump
 * button's label and the focus bridge's "is it listed yet" poll. The one that
 * navigates, `useNavigateToLastUnread`, refuses an archiving workspace itself.
 * @param projects - Projects to search
 * @param workspaceId - Workspace to find
 * @returns The (project, workspace) pair, or null when no project holds it
 */
export function findWorkspaceSelectionById(
	projects: ProjectShellModel[],
	workspaceId: string,
): WorkspaceNavigationSelection | null {
	for (const project of projects) {
		const workspace = project.workspaces.find(
			(candidate) =>
				candidate.id === workspaceId && !candidate.isPendingCreation,
		);
		if (workspace) {
			return { project, source: 'route', workspace };
		}
	}

	return null;
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

/**
 * Returns the first available workspace within a specific project, used to keep
 * routing inside the last-active project when its stored workspace is gone.
 * Returns null when the project itself is gone or has no workspaces left, which
 * is what holds the app on Welcome instead of crossing into another project.
 */
function getFirstWorkspaceSelectionInProject(
	projects: ProjectShellModel[],
	projectId: string,
	unavailableWorkspaceIds?: ReadonlySet<string>,
): WorkspaceNavigationSelection | null {
	const project = projects.find((candidate) => candidate.id === projectId);
	const workspace = project?.workspaces.find((candidate) =>
		isSelectableWorkspace(candidate, unavailableWorkspaceIds),
	);

	return project && workspace
		? {
				project,
				source: 'first',
				workspace,
			}
		: null;
}

/** Returns the first available (project, workspace) pair as a selection. */
function getFirstWorkspaceSelection(
	projects: ProjectShellModel[],
	unavailableWorkspaceIds?: ReadonlySet<string>,
): WorkspaceNavigationSelection | null {
	for (const project of projects) {
		const workspace = project.workspaces.find((candidate) =>
			isSelectableWorkspace(candidate, unavailableWorkspaceIds),
		);

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
