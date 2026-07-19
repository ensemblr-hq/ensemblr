/**
 * Domain model types for the workbench: projects, workspaces, sessions,
 * dock tabs, review, pull requests, workspace sources, and route search
 * params. These describe the *content* the workbench renders.
 *
 * For UI-shell scaffolding around the model — navigation state, shell
 * props, view modes, dock actions, health — see `types/workbench-shell/`.
 */
export type { AgentActionKind } from './agent-actions';
export type { AutocompleteKind, AutocompleteState } from './autocomplete';
export type { CheckpointRestoreTarget } from './checkpoint';
export type {
	GroupedOptions,
	LinkedIssueComposerSeedInput,
	SlashCommandDescriptor,
} from './composer';
export type {
	ReviewFilePreviewOpener,
	WorkspaceFileDiffOpener,
} from './file-preview';
export type { FileTreeNode, FlatFileTreeRow } from './file-tree';
export type { GithubRepoRef } from './github';
export type {
	StoredWorkspaceSelection,
	WorkspaceNavigationRenderState,
	WorkspaceNavigationSelection,
	WorkspaceRouteParams,
} from './navigation';
export type { OpenTargetPathOptions, OpenTargetsState } from './open-targets';
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
export type {
	DiscardChangesTarget,
	FileTreeMenuTarget,
	ReviewActionsValue,
	ReviewFileActions,
	ReviewFileMenuTarget,
} from './review';
export type {
	PullRequestHeaderTone,
	RightSidebarHeaderState,
} from './right-sidebar-header';
export type { WorkbenchRouteSearch } from './routing';
export type {
	CommentPreviewPayload,
	ComposerContextUsage,
	ComposerModelOption,
	ComposerShellState,
	ComposerThinkingOption,
	DockTabId,
	DockTabModel,
	DockTabStatus,
	ExternalAttachment,
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
	WorkspaceScriptSummary,
	WorkspaceShellData,
	WorkspaceShellModel,
	WorkspaceStatus,
} from './workspace';
export type {
	WorkspaceCreationSeed,
	WorkspaceSourceItem,
} from './workspace-sources';
