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
	ProjectShellModel,
	RecentProject,
	WorkspaceSource,
	WorkspaceSourceAction,
	WorkspaceSourceKind,
	WorkspaceSourceProvider,
} from './project';
export type { WorkbenchRouteSearch } from './routing';
export type {
	ComposerContextUsage,
	ComposerModelOption,
	ComposerShellState,
	ComposerThinkingOption,
	DockTabId,
	DockTabModel,
	DockTabStatus,
	FixedDockTabId,
	PullRequestCheckStatus,
	PullRequestCheckSummary,
	PullRequestCommentSummary,
	PullRequestGitStatusSummary,
	PullRequestPreviewDeploymentSummary,
	PullRequestShellStatus,
	PullRequestTodoSummary,
	ReviewFileSummary,
	ReviewPanelTab,
	RunScriptDockTabModel,
	SessionTabModel,
	SetupScriptDockTabModel,
	TerminalDockTabId,
	TerminalDockTabModel,
	WorkbenchShellData,
	WorkspaceFileSummary,
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
	WorkspaceShellData,
	WorkspaceShellModel,
	WorkspaceStatus,
} from './workspace';
