import type { AgentProviderId } from '@/shared/agent-provider';
import type { ModelVendorId } from '@/shared/ipc/contracts/agent-models';
import type { HealthSnapshot } from '@/shared/ipc/contracts/health';
import type { WorkspaceOpenTargetSnapshot } from '@/shared/ipc/contracts/open-target';
// `WorkspaceOpenTarget` is re-exported here for the renderer's query result
// type (`workspaceOpenTargetsQuery`); it is no longer a property of the
// workspace shell model — the menu reads it from the React Query cache.
import type { RepositoryWorkspaceNavigationSnapshot } from '@/shared/ipc/contracts/repository-navigation';
import type { RepositoryPreviewUrl } from '@/shared/ipc/contracts/repository-settings';
import type { ReviewCommentOrigin } from '@/shared/ipc/contracts/review-comments';
import type { SetupDiagnosticsSnapshot } from '@/shared/ipc/contracts/setup';
import type { TerminalSessionStatus } from '@/shared/ipc/contracts/terminal';
import type {
	WorkspaceGitDiffScope,
	WorkspaceGitFailure,
} from '@/shared/ipc/contracts/workspace-git';
import type { RunScriptDefinition } from '@/shared/scripts';
import type { GithubRepoRef } from './github';

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
	kind: 'terminal';
	label: string;
	/** Live status of the bound main-process terminal session. */
	sessionStatus: TerminalSessionStatus;
	status: DockTabStatus;
	/** Main-process terminal session id backing this tab. */
	terminalId: string;
}

export type DockTabModel =
	| RunScriptDockTabModel
	| SetupScriptDockTabModel
	| TerminalDockTabModel;

// --- Review -----------------------------------------------------------------

export type ReviewPanelTab = 'changes' | 'checks' | 'files';

export interface ReviewFileSummary {
	additions: number;
	/**
	 * Opaque stamp of the file's current bytes, or null where the scope's content
	 * cannot change and where git could not read the path. Backs the expiry of a
	 * review "viewed" mark.
	 */
	contentId: string | null;
	deletions: number;
	id: string;
	path: string;
	/** Previous path when `status` is `renamed`; discarding restores it too. */
	renamedFrom?: string;
	status:
		| 'added'
		| 'conflicted'
		| 'deleted'
		| 'modified'
		| 'renamed'
		| 'untracked';
}

export interface WorkspaceFileSummary {
	id: string;
	/** True when git ignores this entry; the all-files tree dims it. */
	isIgnored?: boolean;
	kind: 'directory' | 'file';
	name: string;
	path: string;
}

/** A workspace file-tree entry that a path written by an agent was matched to. */
export interface WorkspacePathMatch {
	kind: 'directory' | 'file';
	/**
	 * Canonical workspace-relative path; may be longer than the one asked for.
	 * Absolute when `scope` is `external`, since no relative form exists.
	 */
	path: string;
	/**
	 * Whether the match came from the workspace file tree or names a file outside
	 * the workspace root, which the tree can never hold.
	 */
	scope: 'external' | 'workspace';
}

/**
 * Matches a path an agent wrote against the workspace file tree. Returns null
 * when the tree does not hold it, which is what makes a chip inert rather than
 * opening a preview onto a file that was deleted, moved, or never existed. A
 * path outside the workspace root resolves as `external` instead: the tree has
 * no opinion on it, but the preview can still read it.
 */
export type WorkspacePathResolver = (
	filePath: string,
) => WorkspacePathMatch | null;

/**
 * A large pasted/dropped file referenced by absolute filesystem path instead of
 * being copied into the workspace. Distinct from {@link WorkspaceFileSummary},
 * whose path is workspace-relative and read back through the file IPC.
 */
export interface ExternalAttachment {
	absolutePath: string;
	name: string;
	sizeBytes: number;
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

/** One reply on a review thread, shown under the head comment in the preview. */
export interface PullRequestCommentReplySummary {
	author?: string;
	body: string;
	createdAt?: string;
	id: string;
}

export interface PullRequestCommentSummary {
	author?: string;
	/** Full comment markdown with bot metadata stripped; what the preview renders. */
	body: string;
	createdAt?: string;
	/** One-line label for the row, derived from `body`. */
	detail: string;
	id: string;
	/** True when the review thread no longer maps to the current diff. */
	isOutdated?: boolean;
	/** Resolution state for GitHub review threads; absent when not applicable. */
	isResolved?: boolean | null;
	line?: number;
	/**
	 * Who wrote an Ensemblr-local comment; absent for every other provider. A
	 * local comment spends its `author` slot on the `path:line` location, so
	 * authorship needs a field of its own to reach the row.
	 */
	origin?: ReviewCommentOrigin;
	path?: string;
	provider: 'github' | 'github-actions' | 'linear' | 'local';
	replies?: readonly PullRequestCommentReplySummary[];
	url?: string;
}

/**
 * Self-contained comment payload carried inline on a `document` session tab so
 * the comment preview survives reloads without re-fetching — the whole thread
 * rides along, and `prNumber` lets the preview's "Add to chat" reuse the same
 * context formatter the Checks panel uses.
 */
export interface CommentPreviewPayload extends PullRequestCommentSummary {
	prNumber?: number;
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

/**
 * What the branch is carrying that the remote does not have yet, and therefore
 * which action publishes it: nothing (`clean`), working-tree edits
 * (`uncommitted`), commits on a branch with no upstream (`unpublished`), or
 * commits ahead of an existing upstream (`unpushed`).
 */
export type PullRequestGitStatusKind =
	| 'clean'
	| 'uncommitted'
	| 'unpublished'
	| 'unpushed';

export interface PullRequestGitStatusSummary {
	actionLabel?: string;
	kind: PullRequestGitStatusKind;
	label: string;
	status: PullRequestCheckStatus | 'open';
}

// --- Session / composer -----------------------------------------------------

interface SessionTabBase {
	id: string;
	chatTabId: string;
	/**
	 * Ensemblr agent session bound to this tab, or `null` when none is. This is the
	 * app's own session row — the id that `stopAgentSession`, checkpoints, and the
	 * composer address. The terminal variant additionally carries
	 * `harnessSessionId`, the harness CLI's own id, which is never interchangeable
	 * with this one.
	 */
	agentSessionId: string | null;
	label: string;
	/**
	 * Untruncated `label`, for the tab tooltip. `label` is capped for display, so
	 * the two differ only when the full name exceeded that cap. Absent on
	 * placeholder and fixture tabs, whose label is already the whole name.
	 */
	fullLabel?: string;
	status: 'blocked' | 'idle' | 'working';
	summary: string;
	updatedLabel: string;
	/** True when this tab hosts a spawned sub-agent, for distinct tinting. */
	isSubAgent: boolean;
	/**
	 * True while this tab holds the workspace's ephemeral preview slot: the next
	 * preview open retargets it, and the strip renders its label in italics.
	 */
	isPreview: boolean;
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
			/** Which diff to fetch for `filePath`; absent means the working tree. */
			diffScope?: WorkspaceGitDiffScope | null;
			filePath: string | null;
			kind: 'diff';
			turnId: string | null;
	  })
	| (SessionTabBase & {
			/** Inline PR-comment payload when this document tab previews a comment. */
			commentPreview?: CommentPreviewPayload;
			filePath: string | null;
			kind: 'document';
			turnId?: null;
	  })
	| (SessionTabBase & {
			filePath: string | null;
			kind: 'file' | 'preview';
			turnId?: null;
	  })
	| (SessionTabBase & {
			/** Main-process terminal session id backing the embedded xterm. */
			terminalId: string;
			/** Registry id of the launched agent harness. */
			harnessId: string;
			/** Display label of the launched harness (also the tab title). */
			harnessLabel: string;
			/**
			 * Native session id the harness CLI (Claude/Codex/Vibe) records for this
			 * conversation, when captured. Persisted on close so a restored terminal
			 * tab can reattach the exact conversation via `--resume <id>`. Distinct
			 * from `agentSessionId`, which is the Ensemblr agent session: only the
			 * latter may be passed to Ensemblr session APIs.
			 */
			harnessSessionId: string | null;
			filePath?: null;
			kind: 'terminal';
			turnId?: null;
	  });

/**
 * One model in the composer picker. The two fields below are different axes:
 * `agentProvider` is the agent runtime that would drive the chat and is what the
 * per-chat provider pin compares against, while `vendor` is the inference vendor
 * (`anthropic`, `openai`, `claude-code`) the picker groups by.
 */
export interface ComposerModelOption {
	agentProvider: AgentProviderId;
	/**
	 * Context window in tokens as the runtime's catalog names it, or null when it
	 * publishes none. Stands in as the gauge's denominator until a session has
	 * measured one.
	 */
	contextWindow: number | null;
	displayName: string;
	id: string;
	isDefault?: boolean;
	vendor: ModelVendorId;
}

export interface ComposerThinkingOption {
	id: string;
	label: string;
}

export interface ComposerContextUsage {
	maxTokens: number;
	usedTokens: number;
}

/**
 * What a submit reports back. The composer clears the draft before awaiting, so
 * a send that failed has to say so or the message is gone with nothing but a
 * `lastError` to show for it. An outcome rather than a rejection: throwing would
 * propagate through the plan-review and primed-action paths, which have no
 * draft to restore and no way to report one.
 */
export interface ComposerSubmitOutcome {
	error?: string;
}

export interface ComposerShellState {
	activeAgentSessionId: string | null;
	availableModels: readonly ComposerModelOption[];
	availableThinkingLevels: readonly ComposerThinkingOption[];
	contextUsage: ComposerContextUsage | null;
	disabled: boolean;
	disabledReason: string | null;
	isStreaming: boolean;
	/**
	 * Agent runtime this chat is pinned to, or `null` while it is still new and
	 * any runtime may be chosen. Set once the chat has a session, after which the
	 * model picker disables every other runtime's models.
	 */
	lockedProvider: AgentProviderId | null;
	modelId: string | null;
	modelLabel: string;
	onModelChange: (modelId: string) => void;
	onPlanModeChange: (planMode: boolean) => void;
	onStop: () => Promise<void> | void;
	onSubmit: (
		prompt: string,
		options?: { streamingBehavior?: 'steer' | 'followUp' },
	) => Promise<ComposerSubmitOutcome>;
	onThinkingChange: (thinkingLevel: string) => void;
	placeholder: string;
	/** Whether this chat is planning: mutating tools are blocked until a plan is approved. */
	planMode: boolean;
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
	/** Auto-detected local dev-server URL for a running run script, when seen. */
	previewUrl?: string | null;
	/** Name of the run script the latest session ran, when it carried one. */
	scriptName?: string | null;
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
	/** Issue body/description, seeded into the first-prompt composer draft. */
	description?: string;
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
export type WorkspaceLandingCopyState = 'copied' | 'unavailable';

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

export type WorkspaceOpenTarget = WorkspaceOpenTargetSnapshot;

export interface WorkspaceShellModel {
	/**
	 * True when the workspace took over a branch that already existed rather than
	 * cutting its own. Such a branch may back a pull request, so the rename dialog
	 * pins it instead of offering to move it.
	 */
	adoptedBranch?: boolean;
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
	/** Owner/repo parsed from the repository's GitHub remote, when it has one. */
	githubRepo?: GithubRepoRef | null;
	/**
	 * Repo-configured preview URLs (personal SQLite overrides) shown on the dock
	 * Open control instead of the auto-detected URL. Resolved at the route-content
	 * level so leaf dock components stay free of data hooks.
	 */
	configuredPreviewUrls?: RepositoryPreviewUrl[];
	id: string;
	/** True for optimistic rows shown while the main process creates the workspace. */
	isPendingCreation?: boolean;
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
		/**
		 * Whether GitHub reports the pull request as conflicting with its base.
		 * Kept separate from `status`, which folds conflicts in with failing checks
		 * and requested changes under `blocked`.
		 */
		isConflicting?: boolean;
		label: string;
		number?: number;
		previewDeployment?: PullRequestPreviewDeploymentSummary;
		/** GitHub PR state; absent before a snapshot lands (treated as open). */
		state?: 'closed' | 'merged' | 'open';
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
	/**
	 * Typed failure surfaced when live git status could not be read for the
	 * worktree. The code drives the panel's explanation; the message carries
	 * git's own words.
	 */
	reviewFilesError?: WorkspaceGitFailure;
	/** Named run scripts the dock's Run menu offers, in declaration order. */
	runScripts: RunScriptDefinition[];
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
