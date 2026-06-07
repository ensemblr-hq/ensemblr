import {
	DEFAULT_DOCK_TAB,
	DEFAULT_TERMINAL_DOCK_TAB_ID,
} from '@/renderer/lib/workbench/constants';
import type {
	DockTabModel,
	ProjectShellModel,
	SessionTabModel,
	WorkspaceOpenTarget,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type {
	RepositoryWorkspaceNavigationRepository,
	RepositoryWorkspaceNavigationSnapshot,
	RepositoryWorkspaceNavigationWorkspace,
} from '@/shared/ipc';

/** Identifies the active project/workspace and how it was chosen. */
export interface WorkspaceNavigationSelection {
	project: ProjectShellModel;
	source: 'first' | 'route' | 'stored';
	workspace: WorkspaceShellModel;
}

/** Persisted last-known workspace selection. */
export interface StoredWorkspaceSelection {
	projectId: string;
	workspaceId: string;
}

/** Render-time projection of the workspace navigation state. */
export interface WorkspaceNavigationRenderState {
	projects: ProjectShellModel[];
	selection: WorkspaceNavigationSelection;
	source: 'current' | 'previous';
}

/** Returns placeholder "open in" targets surfaced before integrations are wired. */
function createPlaceholderOpenTargets(): WorkspaceOpenTarget[] {
	return [
		{
			iconName: 'lucide:folder',
			id: 'finder',
			installed: true,
			kind: 'file-manager',
			label: 'Finder',
			numberShortcutLabel: '1',
		},
		{
			iconName: 'vscode-icons:file-type-vscode',
			id: 'vscode',
			installed: true,
			isPrimary: true,
			kind: 'editor',
			label: 'VS Code',
			numberShortcutLabel: '2',
			shortcutLabel: '⌘O',
		},
		{
			iconName: 'lucide:square-terminal',
			id: 'terminal',
			installed: true,
			kind: 'terminal',
			label: 'Terminal',
			numberShortcutLabel: '3',
		},
		{
			iconName: 'lucide:copy',
			id: 'copy-path',
			installed: true,
			kind: 'utility',
			label: 'Copy path',
			numberShortcutLabel: '4',
			shortcutLabel: '⌘⇧C',
		},
	];
}

/**
 * Maps a navigation snapshot to renderer project shell models.
 * @param snapshot - Navigation snapshot or null.
 * @returns Project shell models (possibly empty).
 */
export function mapNavigationSnapshotToProjects(
	snapshot?: RepositoryWorkspaceNavigationSnapshot | null,
): ProjectShellModel[] {
	return mapRepositoriesToProjects(snapshot?.repositories);
}

/**
 * Maps repository navigation rows to renderer project shell models.
 * @param repositories - Repository rows.
 * @returns Project shell models (possibly empty).
 */
export function mapRepositoriesToProjects(
	repositories?: RepositoryWorkspaceNavigationRepository[] | null,
): ProjectShellModel[] {
	return (
		repositories?.map((repository) =>
			mapRepositoryNavigationSnapshot(repository),
		) ?? []
	);
}

/**
 * Picks the navigation snapshot to render, preferring fresh query data over a
 * previously-cached snapshot.
 * @param input - Both snapshots; either may be absent.
 * @returns The chosen snapshot, or `null` when both are missing.
 */
export function getRenderableNavigationSnapshot({
	cachedSnapshot,
	querySnapshot,
}: {
	cachedSnapshot?: RepositoryWorkspaceNavigationSnapshot;
	querySnapshot?: RepositoryWorkspaceNavigationSnapshot;
}): RepositoryWorkspaceNavigationSnapshot | null {
	return querySnapshot ?? cachedSnapshot ?? null;
}

/**
 * Picks the active workspace selection, preferring the URL route, then the
 * stored selection, then the first available workspace.
 * @param input - Projects plus route ids and stored selection.
 * @returns The chosen selection, or `null` when there is none.
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
 * @param input - Selection plus previous render state and route ids.
 * @returns The next render state, or `null` when nothing should render.
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

/**
 * Looks up a (project, workspace) selection by id pair.
 * @param projects - Project shell models.
 * @param projectId - Target project id.
 * @param workspaceId - Target workspace id.
 * @param source - Source label assigned to the resulting selection.
 * @returns The matching selection, or `null` when no project/workspace pair matches.
 */
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
 * @param workspace - Active workspace.
 * @param sessionId - Optional explicit session id.
 * @returns A {@link SessionTabModel}.
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

/** Route params for a fully-resolved workspace navigation target. */
export interface WorkspaceRouteParams {
	chatId: string;
	projectId: string;
	workspaceId: string;
}

/**
 * Resolves a (project, workspace) target into the matching route params,
 * including a preferred chat id.
 * @param projects - Project shell models.
 * @param projectId - Target project id.
 * @param workspaceId - Target workspace id.
 * @returns Resolved route params, or `null` when no match exists.
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

/** Maps one repository row to a project shell model, with placeholder workspace data. */
function mapRepositoryNavigationSnapshot(
	repository: RepositoryWorkspaceNavigationRepository,
): ProjectShellModel {
	const ownerName =
		getMetadataString(repository.metadata, ['ownerName', 'owner']) ??
		getParentDirectoryName(repository.path) ??
		repository.slug;
	const avatarUrl = getMetadataString(repository.metadata, [
		'avatarUrl',
		'ownerAvatarUrl',
		'githubAvatarUrl',
	]);

	return {
		id: repository.id,
		name: repository.name || repository.slug,
		owner: {
			...(avatarUrl ? { avatarUrl } : {}),
			name: ownerName,
		},
		pathLabel: repository.path,
		workspaces: repository.workspaces.map((workspace) =>
			mapWorkspaceNavigationSnapshot(repository, workspace),
		),
	};
}

/** Maps one workspace row to a workspace shell model with placeholder details. */
function mapWorkspaceNavigationSnapshot(
	repository: RepositoryWorkspaceNavigationRepository,
	workspace: RepositoryWorkspaceNavigationWorkspace,
): WorkspaceShellModel {
	const branchName =
		workspace.branchName ??
		workspace.baseBranch ??
		repository.defaultBranch ??
		workspace.slug;

	return {
		branchName,
		changeSummary: {
			additions: 0,
			deletions: 0,
			files: 0,
		},
		checks: {
			detail:
				'Live workspace navigation is loaded from SQLite. Checks are not wired yet.',
			label: 'No checks',
			status: 'pending',
		},
		dockTabs: createPlaceholderDockTabs(),
		id: workspace.id,
		name: workspace.name || workspace.slug,
		openTargets: createPlaceholderOpenTargets(),
		pathLabel: workspace.path,
		projectId: repository.id,
		pullRequest: {
			checks: [],
			comments: [],
			description: [],
			detail: 'Pull request data is not wired for this workspace yet.',
			gitStatus: {
				label: 'No PR open',
				status: 'open',
			},
			label: 'No PR',
			status: 'idle',
			title: '',
			todos: [],
		},
		reviewFiles: [],
		scripts: createPlaceholderScripts(),
		sessions: [createPlaceholderSessionFromSnapshot(workspace)],
		sourceSummary: getWorkspaceSourceSummary(repository, workspace),
		status: 'idle',
		workspaceFiles: [],
	};
}

/** Returns the placeholder dock tabs (setup/run/default terminal). */
function createPlaceholderDockTabs(): DockTabModel[] {
	return [
		{
			id: 'setup',
			kind: 'setup-script',
			label: 'Setup',
			status: 'idle',
		},
		{
			id: 'run',
			kind: 'run-script',
			label: 'Run',
			status: 'idle',
		},
		{
			id: DEFAULT_TERMINAL_DOCK_TAB_ID,
			isDefault: true,
			kind: 'terminal',
			label: 'Terminal',
			lines: [
				'$ zsh',
				'Terminal session loading is not wired for this workspace yet.',
			],
			sessionId: 'terminal-default',
			status: 'idle',
		},
	];
}

/** Returns placeholder run/setup script blocks marked as missing. */
function createPlaceholderScripts(): WorkspaceShellModel['scripts'] {
	return {
		run: {
			lines: [],
			status: 'missing',
		},
		setup: {
			lines: [],
			status: 'missing',
		},
	};
}

/** Builds a placeholder session tab from a workspace navigation row. */
function createPlaceholderSessionFromSnapshot(
	workspace: RepositoryWorkspaceNavigationWorkspace,
): SessionTabModel {
	return {
		id: `${workspace.id}:overview`,
		label: 'Workspace',
		status: 'idle',
		summary:
			'SQLite workspace record loaded. Agent sessions are not wired yet.',
		updatedLabel: 'loaded',
	};
}

/** Builds a placeholder session tab from a workspace shell model. */
function createPlaceholderSession(
	workspace: WorkspaceShellModel,
): SessionTabModel {
	return {
		id: `${workspace.id}:overview`,
		label: 'Workspace',
		status: 'idle',
		summary: 'Workspace session placeholder.',
		updatedLabel: 'loaded',
	};
}

/**
 * Renders a short summary of the workspace's source branch.
 * @param repository - Parent repository row.
 * @param workspace - Workspace row.
 * @returns A user-facing summary string.
 */
function getWorkspaceSourceSummary(
	repository: RepositoryWorkspaceNavigationRepository,
	workspace: RepositoryWorkspaceNavigationWorkspace,
): string {
	if (workspace.baseBranch) {
		return `branched from ${workspace.baseBranch}`;
	}

	if (repository.defaultBranch) {
		return `repository default branch ${repository.defaultBranch}`;
	}

	return 'workspace loaded from SQLite';
}

/**
 * Returns the first non-empty trimmed string value found at any of the candidate keys.
 * @param metadata - Source metadata record.
 * @param keys - Candidate keys, in priority order.
 * @returns The first matching string, or `null`.
 */
function getMetadataString(
	metadata: Record<string, unknown>,
	keys: string[],
): string | null {
	for (const key of keys) {
		const value = metadata[key];

		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
	}

	return null;
}

/**
 * Extracts the parent directory name from a posix-style path.
 * @param filePath - File path.
 * @returns The parent directory name, or `null` when none can be determined.
 */
function getParentDirectoryName(filePath: string): string | null {
	const normalizedPath = filePath.replace(/\/+$/, '');
	const parentDirectory = normalizedPath.split('/').at(-2);

	return parentDirectory || null;
}

/** Default dock tab used for live workspaces backed by the SQLite navigation. */
export const DEFAULT_LIVE_WORKSPACE_DOCK_TAB = DEFAULT_DOCK_TAB;
