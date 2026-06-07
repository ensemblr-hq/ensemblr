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
