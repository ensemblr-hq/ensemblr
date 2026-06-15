import type { HealthSnapshot } from '@/shared/ipc/contracts/health';
import type {
	WorkspaceOpenTargetKind as SharedWorkspaceOpenTargetKind,
	WorkspaceOpenTargetSnapshot,
} from '@/shared/ipc/contracts/open-target';
// `WorkspaceOpenTarget` is re-exported here for the renderer's query result
// type (`workspaceOpenTargetsQuery`); it is no longer a property of the
// workspace shell model — the menu reads it from the React Query cache.
import type { RepositoryWorkspaceNavigationSnapshot } from '@/shared/ipc/contracts/repository-navigation';
import type { SetupDiagnosticsSnapshot } from '@/shared/ipc/contracts/setup';
import type { TerminalSessionStatus } from '@/shared/ipc/contracts/terminal';

import type { ProjectShellModel } from './project';

// --- Dock tabs --------------------------------------------------------------

export type FixedDockTabId = 'run' | 'setup';
export type TerminalDockTabId = `terminal:${string}`;
export type DockTabId = FixedDockTabId | TerminalDockTabId;
export type DockTabStatus = 'idle' | 'ready' | 'running' | 'warning';

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
	/** Live session status, or `null` for the placeholder default tab. */
	sessionStatus: TerminalSessionStatus | null;
	status: DockTabStatus;
	/** Main-process terminal session id, or `null` before a session exists. */
	terminalId: string | null;
}

export type DockTabModel =
	| RunScriptDockTabModel
	| SetupScriptDockTabModel
	| TerminalDockTabModel;

// --- Review -----------------------------------------------------------------

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

// --- Pull request -----------------------------------------------------------

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
	author?: string;
	detail: string;
	id: string;
	/** Resolution state for GitHub review threads; absent when not applicable. */
	isResolved?: boolean | null;
	provider: 'github' | 'github-actions' | 'linear' | 'local';
	url?: string;
}

export interface PullRequestTodoSummary {
	id: string;
	label: string;
	status?: 'done' | 'open';
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

// --- Session / composer -----------------------------------------------------

export type SessionTabKind = 'chat' | 'diff' | 'document' | 'file' | 'preview';

interface SessionTabBase {
	id: string;
	chatTabId: string;
	piSessionId: string | null;
	label: string;
	status: 'blocked' | 'idle' | 'working';
	summary: string;
	updatedLabel: string;
}

/**
 * Discriminated on `kind` so file paths only exist on file-like tabs and turn
 * ids only on diff tabs. `kind` is optional on the chat variant because
 * placeholder/fixture sessions predate tab kinds and are treated as chat.
 * Nullable payload fields reflect untyped wire metadata: a persisted row may
 * legitimately lack them.
 */
export type SessionTabModel =
	| (SessionTabBase & { filePath?: null; kind?: 'chat'; turnId?: null })
	| (SessionTabBase & {
			filePath: string | null;
			kind: 'diff';
			turnId: string | null;
	  })
	| (SessionTabBase & {
			filePath: string | null;
			kind: 'document' | 'file' | 'preview';
			turnId?: null;
	  });

export interface ComposerModelOption {
	displayName: string;
	id: string;
	isDefault?: boolean;
	provider: string;
}

export interface ComposerThinkingOption {
	id: string;
	label: string;
}

export interface ComposerContextUsage {
	maxTokens: number;
	usedTokens: number;
}

export interface ComposerShellState {
	activePiSessionId: string | null;
	availableModels: readonly ComposerModelOption[];
	availableThinkingLevels: readonly ComposerThinkingOption[];
	contextUsage: ComposerContextUsage | null;
	disabled: boolean;
	disabledReason: string | null;
	isStreaming: boolean;
	modelId: string | null;
	modelLabel: string;
	onModelChange: (modelId: string) => void;
	onStop: () => Promise<void> | void;
	onSubmit: (
		prompt: string,
		options?: { streamingBehavior?: 'steer' | 'followUp' },
	) => Promise<void> | void;
	onThinkingChange: (thinkingLevel: string) => void;
	placeholder: string;
	thinkingLabel: string;
	thinkingLevel: string | null;
	workspaceCwd: string;
	workspaceFiles: readonly WorkspaceFileSummary[];
}

// --- Workspace domain -------------------------------------------------------

export type WorkspaceStatus = 'idle' | 'needs-setup' | 'review' | 'working';

export interface WorkspaceScriptSummary {
	command?: string;
	port?: number;
	/** Status of the most recent script session, when one exists. */
	sessionStatus?: TerminalSessionStatus | null;
	status: 'missing' | 'not-run' | 'running' | 'stopped' | 'succeeded';
	/** Terminal session id of the most recent script run, when one exists. */
	terminalId?: string | null;
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
	/** Remote issue id used to resolve live status from the provider cache. */
	remoteId?: string;
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
	repositoryName: string;
	setupGuidance: WorkspaceLandingSetupSummary;
	workspaceName: string;
}

export type WorkspaceOpenTargetKind = SharedWorkspaceOpenTargetKind;

export type WorkspaceOpenTarget = WorkspaceOpenTargetSnapshot;

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
		/** Last refresh error from the gh metadata service, when one occurred. */
		syncError?: string;
		/** ISO timestamp of the last successful gh snapshot refresh. */
		syncedAt?: string;
		title: string;
		todos: PullRequestTodoSummary[];
		url?: string;
	};
	reviewFiles: ReviewFileSummary[];
	/** Error surfaced when live git status could not be read for the worktree. */
	reviewFilesError?: string;
	scripts: {
		run: WorkspaceScriptSummary;
		setup: WorkspaceScriptSummary;
	};
	sessions: SessionTabModel[];
	sourceSummary: string;
	status: WorkspaceStatus;
	workspaceFiles: WorkspaceFileSummary[];
}

// --- Shell data -------------------------------------------------------------

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
