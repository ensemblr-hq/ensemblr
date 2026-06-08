/**
 * Domain model types for the workbench: projects, workspaces, sessions,
 * dock tabs, review, pull requests, workspace sources, and route search
 * params. These describe the *content* the workbench renders.
 *
 * For UI-shell scaffolding around the model — navigation state, shell
 * props, view modes, dock actions, health — see `types/workbench-shell/`.
 */
export type {
	AddProjectActionId,
	AddProjectActionModel,
	AddProjectMenuModel,
	RecentProject,
} from './add-project';
export type {
	DockTabId,
	DockTabModel,
	DockTabStatus,
	FixedDockTabId,
	RunScriptDockTabModel,
	SetupScriptDockTabModel,
	TerminalDockTabId,
	TerminalDockTabModel,
} from './dock-tabs';
export type { ProjectShellModel } from './project';
export type {
	PullRequestCheckStatus,
	PullRequestCheckSummary,
	PullRequestCommentSummary,
	PullRequestGitStatusSummary,
	PullRequestPreviewDeploymentSummary,
	PullRequestShellStatus,
	PullRequestTodoSummary,
} from './pull-request';
export type {
	ReviewFileSummary,
	ReviewPanelTab,
	WorkspaceFileSummary,
} from './review';
export type { WorkbenchRouteSearch } from './route-search';
export type { ComposerShellState, SessionTabModel } from './session';
export type { WorkbenchShellData, WorkspaceShellData } from './shell-data';
export type {
	WorkspaceLandingBranchSummary,
	WorkspaceLandingCopyState,
	WorkspaceLandingCopySummary,
	WorkspaceLandingKind,
	WorkspaceLandingSetupState,
	WorkspaceLandingSetupSummary,
	WorkspaceLandingSummary,
	WorkspaceLinkedIssueProvider,
	WorkspaceLinkedIssueSummary,
	WorkspaceOpenTarget,
	WorkspaceOpenTargetKind,
	WorkspaceScriptSummary,
	WorkspaceShellModel,
	WorkspaceStatus,
} from './workspace';
export type {
	WorkspaceSource,
	WorkspaceSourceAction,
	WorkspaceSourceKind,
	WorkspaceSourceProvider,
} from './workspace-source';
