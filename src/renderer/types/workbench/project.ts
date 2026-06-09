import type { WorkspaceShellModel } from './workspace';

// --- Project shell ----------------------------------------------------------

export interface ProjectShellModel {
	id: string;
	name: string;
	owner: {
		avatarUrl?: string;
		name: string;
	};
	pathLabel: string;
	workspaces: WorkspaceShellModel[];
}

// --- Add project menu -------------------------------------------------------

export type AddProjectActionId = 'open-github' | 'open-local' | 'quick-start';

export interface AddProjectActionModel {
	enabled: boolean;
	id: AddProjectActionId;
	label: string;
	unavailableReason: string | null;
}

export interface RecentProject {
	lastOpenedAt: string;
	name?: string;
	path: string;
}

export interface AddProjectMenuModel {
	actions: AddProjectActionModel[];
	recents: RecentProject[];
}

// --- Workspace source -------------------------------------------------------

export type WorkspaceSourceKind = 'branch' | 'issue' | 'pull-request';
export type WorkspaceSourceProvider = 'github' | 'linear' | 'local-git';

export interface WorkspaceSource {
	hasWorkspace?: boolean;
	id: string;
	kind: WorkspaceSourceKind;
	provider: WorkspaceSourceProvider;
	reference?: string;
	subtitle?: string;
	title: string;
}

export interface WorkspaceSourceAction {
	id: string;
	label: string;
	shortcut: string;
	variant: 'primary' | 'secondary';
}
