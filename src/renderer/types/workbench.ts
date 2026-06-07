import type {
	HealthSnapshot,
	RepositoryWorkspaceNavigationSnapshot,
	SetupDiagnosticsSnapshot,
} from '@/shared/ipc';

export type ReviewPanelTab = 'changes' | 'checks' | 'files';

export type FixedDockTabId = 'run' | 'setup';
export type TerminalDockTabId = `terminal:${string}`;
export type DockTabId = FixedDockTabId | TerminalDockTabId;
export type DockTabStatus = 'idle' | 'ready' | 'running' | 'warning';

export type WorkspaceStatus = 'idle' | 'needs-setup' | 'review' | 'working';

export type PullRequestShellStatus =
	| 'agent-working'
	| 'blocked'
	| 'checking'
	| 'idle'
	| 'ready-to-merge';

export type PullRequestCheckStatus = 'blocked' | 'pending' | 'ready';

export interface PullRequestCheckSummary {
	durationLabel?: string;
	id: string;
	label: string;
	provider: 'github' | 'local' | 'vercel';
	status: PullRequestCheckStatus;
	url?: string;
}

export interface PullRequestCommentSummary {
	detail: string;
	id: string;
	provider: 'github-actions' | 'linear';
}

export interface PullRequestTodoSummary {
	id: string;
	label: string;
}

export interface PullRequestPreviewDeploymentSummary {
	label: string;
	provider: 'netlify' | 'unknown' | 'vercel';
	source: 'check-link' | 'github-deployment' | 'pr-comment';
	status: PullRequestCheckStatus;
	url: string;
}

export interface PullRequestGitStatusSummary {
	actionLabel?: string;
	label: string;
	status: PullRequestCheckStatus | 'open';
}

export interface SessionTabModel {
	id: string;
	label: string;
	status: 'blocked' | 'idle' | 'working';
	summary: string;
	updatedLabel: string;
}

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

export interface SetupScriptDockTabModel {
	id: 'setup';
	kind: 'setup-script';
	label: string;
	status: DockTabStatus;
}

export interface RunScriptDockTabModel {
	id: 'run';
	kind: 'run-script';
	label: string;
	status: DockTabStatus;
}

export interface TerminalDockTabModel {
	id: TerminalDockTabId;
	isDefault?: boolean;
	kind: 'terminal';
	label: string;
	lines: string[];
	sessionId: string;
	status: DockTabStatus;
}

export type DockTabModel =
	| RunScriptDockTabModel
	| SetupScriptDockTabModel
	| TerminalDockTabModel;

export interface WorkspaceScriptSummary {
	command?: string;
	lines: string[];
	port?: number;
	status: 'missing' | 'not-run' | 'running' | 'stopped' | 'succeeded';
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

export interface ComposerShellState {
	disabled: boolean;
	disabledReason: string | null;
	modelLabel: string;
	placeholder: string;
	thinkingLabel: string;
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

export interface WorkbenchShellData {
	hasPreloadBridge: boolean;
	healthError: string | null;
	healthSnapshot: HealthSnapshot | null;
	navigationError: string | null;
	navigationSnapshot: RepositoryWorkspaceNavigationSnapshot | null;
	projects: ProjectShellModel[];
	setupError: string | null;
	setupSnapshot: SetupDiagnosticsSnapshot | null;
}

export interface WorkspaceShellData {
	project: ProjectShellModel;
	workspace: WorkspaceShellModel;
}

export interface WorkbenchRouteSearch {
	dock?: DockTabId;
	review?: ReviewPanelTab;
}
