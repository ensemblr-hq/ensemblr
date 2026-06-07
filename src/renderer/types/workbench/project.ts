import type { WorkspaceShellModel } from './workspace';

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
