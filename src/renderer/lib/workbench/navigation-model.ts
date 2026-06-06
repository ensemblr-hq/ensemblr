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

export interface WorkspaceNavigationSelection {
	project: ProjectShellModel;
	source: 'first' | 'route' | 'stored';
	workspace: WorkspaceShellModel;
}

export interface StoredWorkspaceSelection {
	projectId: string;
	workspaceId: string;
}

export interface WorkspaceNavigationRenderState {
	projects: ProjectShellModel[];
	selection: WorkspaceNavigationSelection;
	source: 'current' | 'previous';
}

const placeholderOpenTargets: WorkspaceOpenTarget[] = [
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

export function mapNavigationSnapshotToProjects(
	snapshot?: RepositoryWorkspaceNavigationSnapshot | null,
): ProjectShellModel[] {
	return (
		snapshot?.repositories.map((repository) =>
			mapRepositoryNavigationSnapshot(repository),
		) ?? []
	);
}

export function getRenderableNavigationSnapshot({
	cachedSnapshot,
	querySnapshot,
}: {
	cachedSnapshot?: RepositoryWorkspaceNavigationSnapshot;
	querySnapshot?: RepositoryWorkspaceNavigationSnapshot;
}): RepositoryWorkspaceNavigationSnapshot | null {
	return querySnapshot ?? cachedSnapshot ?? null;
}

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
	const routeSelection =
		routeProjectId && routeWorkspaceId
			? findWorkspaceNavigationSelection(
					projects,
					routeProjectId,
					routeWorkspaceId,
					'route',
				)
			: null;

	if (routeProjectId && routeWorkspaceId) {
		return routeSelection;
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

export function resolveWorkspaceNavigationRenderState({
	canUsePreviousState,
	previousState,
	projects,
	selection,
}: {
	canUsePreviousState: boolean;
	previousState?: WorkspaceNavigationRenderState | null;
	projects: ProjectShellModel[];
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
		return {
			...previousState,
			source: 'previous',
		};
	}

	return null;
}

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
		openTargets: placeholderOpenTargets,
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

function getParentDirectoryName(filePath: string): string | null {
	const normalizedPath = filePath.replace(/\/+$/, '');
	const parentDirectory = normalizedPath.split('/').at(-2);

	return parentDirectory || null;
}

export const DEFAULT_LIVE_WORKSPACE_DOCK_TAB = DEFAULT_DOCK_TAB;
