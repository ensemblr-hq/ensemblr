import type { DockTabModel } from './dock-tabs';
import type {
	PullRequestCheckSummary,
	PullRequestCommentSummary,
	PullRequestGitStatusSummary,
	PullRequestPreviewDeploymentSummary,
	PullRequestShellStatus,
	PullRequestTodoSummary,
} from './pull-request';
import type { ReviewFileSummary, WorkspaceFileSummary } from './review';
import type { SessionTabModel } from './session';

export type WorkspaceStatus = 'idle' | 'needs-setup' | 'review' | 'working';

export interface WorkspaceScriptSummary {
	command?: string;
	lines: string[];
	port?: number;
	status: 'missing' | 'not-run' | 'running' | 'stopped' | 'succeeded';
}

export type WorkspaceLandingKind =
	| 'cloned-repo'
	| 'linked-issue'
	| 'local-branch';

export type WorkspaceLinkedIssueProvider = 'github' | 'linear';

export interface WorkspaceLinkedIssueSummary {
	provider: WorkspaceLinkedIssueProvider;
	reference: string;
	subtitle?: string;
	title: string;
	url?: string;
}

export interface WorkspaceLandingBranchSummary {
	baseBranch?: string;
	branchName: string;
	detail: string;
}

export type WorkspaceLandingCopyState = 'copied' | 'skipped' | 'unavailable';

export interface WorkspaceLandingCopySummary {
	count: number;
	detail: string;
	state: WorkspaceLandingCopyState;
}

export type WorkspaceLandingSetupState =
	| 'configured'
	| 'missing'
	| 'pending'
	| 'succeeded';

export interface WorkspaceLandingSetupSummary {
	command?: string;
	detail: string;
	state: WorkspaceLandingSetupState;
}

export interface WorkspaceLandingSummary {
	branchSource: WorkspaceLandingBranchSummary;
	copiedFiles: WorkspaceLandingCopySummary;
	headline: string;
	kind: WorkspaceLandingKind;
	linkedIssue?: WorkspaceLinkedIssueSummary;
	setupGuidance: WorkspaceLandingSetupSummary;
}

export type WorkspaceOpenTargetKind =
	| 'editor'
	| 'file-manager'
	| 'source-control'
	| 'terminal'
	| 'utility';

export interface WorkspaceOpenTarget {
	iconName: string;
	id: string;
	installed: boolean;
	isPrimary?: boolean;
	kind: WorkspaceOpenTargetKind;
	label: string;
	numberShortcutLabel: string;
	shortcutLabel?: string;
}

export interface WorkspaceShellModel {
	branchName: string;
	changeSummary: {
		additions: number;
		deletions: number;
		files: number;
	};
	checks: {
		detail: string;
		label: string;
		status: 'blocked' | 'pending' | 'ready';
	};
	dockTabs: DockTabModel[];
	id: string;
	landingSummary?: WorkspaceLandingSummary;
	name: string;
	openTargets: WorkspaceOpenTarget[];
	pathLabel: string;
	projectId: string;
	pullRequest: {
		checks: PullRequestCheckSummary[];
		comments: PullRequestCommentSummary[];
		description: string[];
		detail: string;
		gitStatus: PullRequestGitStatusSummary;
		label: string;
		number?: number;
		previewDeployment?: PullRequestPreviewDeploymentSummary;
		status: PullRequestShellStatus;
		title: string;
		todos: PullRequestTodoSummary[];
		url?: string;
	};
	reviewFiles: ReviewFileSummary[];
	scripts: {
		run: WorkspaceScriptSummary;
		setup: WorkspaceScriptSummary;
	};
	sessions: SessionTabModel[];
	sourceSummary: string;
	status: WorkspaceStatus;
	workspaceFiles: WorkspaceFileSummary[];
}
