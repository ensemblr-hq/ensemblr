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
export type WorkspaceSourceProvider = 'github' | 'linear';

export interface WorkspaceSource {
	hasWorkspace?: boolean;
	id: string;
	/**
	 * True for the repository's default branch. The repository folder already has
	 * it checked out, so such a row forks a new branch rather than taking it over.
	 */
	isDefaultBranch?: boolean;
	kind: WorkspaceSourceKind;
	provider: WorkspaceSourceProvider;
	reference?: string;
	subtitle?: string;
	title: string;
}

/**
 * Row action a picker source offers. The id selects what selecting the row
 * does: `use-branch` and `create` hand the workspace an existing branch or a
 * fresh one, `duplicate-branch` forks a copy, and `open` navigates to the
 * workspace that already holds the branch.
 */
export type WorkspaceSourceActionId =
	| 'create'
	| 'duplicate-branch'
	| 'open'
	| 'use-branch';

export interface WorkspaceSourceAction {
	id: WorkspaceSourceActionId;
	label: string;
	shortcut: string;
	variant: 'primary' | 'secondary';
}
