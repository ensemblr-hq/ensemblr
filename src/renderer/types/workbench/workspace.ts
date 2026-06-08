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

/** Classifies the provenance used to explain why a workspace was created. */
export type WorkspaceLandingKind =
	| 'cloned-repo'
	| 'linked-issue'
	| 'local-branch';

/** Names the external issue tracker connected to a workspace landing summary. */
export type WorkspaceLinkedIssueProvider = 'github' | 'linear';

/** Describes the issue that seeded a workspace when one is linked. */
export interface WorkspaceLinkedIssueSummary {
	provider: WorkspaceLinkedIssueProvider;
	reference: string;
	subtitle?: string;
	title: string;
	url?: string;
}

/** Describes the branch and base branch shown in the workspace landing card. */
export interface WorkspaceLandingBranchSummary {
	baseBranch?: string;
	branchName: string;
	detail: string;
}

/** Describes whether local-only files were copied into the workspace. */
export type WorkspaceLandingCopyState = 'copied' | 'skipped' | 'unavailable';

/** Summarizes files-to-copy results for a newly created workspace. */
export interface WorkspaceLandingCopySummary {
	count: number;
	detail: string;
	state: WorkspaceLandingCopyState;
}

/** Describes the configured setup-script state for a workspace. */
export type WorkspaceLandingSetupState =
	| 'configured'
	| 'missing'
	| 'pending'
	| 'succeeded';

/** Summarizes setup guidance shown before the first workspace agent turn. */
export interface WorkspaceLandingSetupSummary {
	command?: string;
	detail: string;
	state: WorkspaceLandingSetupState;
}

/** Aggregates the initial workspace context shown above the first chat thread. */
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
