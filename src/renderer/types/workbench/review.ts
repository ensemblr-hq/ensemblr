export type ReviewPanelTab = 'changes' | 'checks' | 'files';

export interface ReviewFileSummary {
	additions: number;
	deletions: number;
	id: string;
	path: string;
	status: 'added' | 'deleted' | 'modified' | 'renamed' | 'untracked';
}

export interface WorkspaceFileSummary {
	id: string;
	kind: 'directory' | 'file';
	name: string;
	path: string;
}
