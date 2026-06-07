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
