import type { PullRequestCommentSummary } from '@/renderer/types/workbench';
import type { WorkspaceGitDiffScope } from '@/shared/ipc/contracts/workspace-git';

export interface WorkbenchHealth {
	detail: string;
	label: string;
	state: 'online' | 'pending' | 'unavailable';
}

export interface WorkbenchDockActions {
	/**
	 * Seeds the active chat composer with a prompt directing the agent to create
	 * the repository's `.ensemblr/settings.toml` setup script. Never auto-submits.
	 */
	onAskAgentSetupScript: () => void;
	onCloseTerminal: (terminalId: string) => void;
	onNewTerminal: () => void;
	/** Opens the detected dev-server preview URL for one run target in the system browser. */
	onOpenRunPort: (runTargetId: string, url: string) => void;
	onOpenSetupScripts: () => void;
	/** Starts the named run target (ADR 0041). */
	onRunScript: (runTargetId: string) => void;
	onRunSetupScript: () => void;
	/** Stops the named run target's active session. */
	onStopRunScript: (runTargetId: string) => void;
	onStopSetupScript: () => void;
}

export type ChangesViewMode = 'folders' | 'list';

/** One label/value pair in a lifecycle dialog summary; `mono` marks machine values such as branches and paths. */
export interface LifecycleSummaryRow {
	label: string;
	mono?: boolean;
	value: string;
}

/**
 * Which slice of history the Changes tab is showing:
 *
 *   - `all`: every change on the branch (diff vs the base branch's fork point).
 *   - `uncommitted`: only the working-tree changes not yet committed.
 *   - `commit`: the changes a single commit introduced. The display fields
 *     (`shortHash`, `subject`) are carried so the badge renders without
 *     re-fetching the commit list.
 */
export type ChangesSource =
	| { kind: 'all' }
	| { kind: 'uncommitted' }
	| { hash: string; kind: 'commit'; shortHash: string; subject: string };

/**
 * Where a newly opened chat tab lands in the strip. `after-active` (the default
 * for every spawned tab) keeps it next to the tab it came from; `append` puts it
 * last and is reserved for the strip's explicit new-tab button.
 */
export type SessionTabPlacement = 'after-active' | 'append';

/**
 * Extended session-tab state surface — adds async open/close handlers used by
 * the conversation-panel SessionTabs to drive routing on mutation success.
 */
export interface SessionTabActions {
	openSessionTab: (options?: {
		placement?: SessionTabPlacement;
	}) => Promise<{ chatTabId: string } | null>;
	openCommentPreviewTab: (input: {
		comment: PullRequestCommentSummary;
		/** Defaults to true; false opens a permanent tab the preview slot skips. */
		preview?: boolean;
		prNumber?: number;
	}) => Promise<{ chatTabId: string } | null>;
	openFilePreviewTab: (input: {
		filePath: string;
		/** Defaults to true; false opens a permanent tab the preview slot skips. */
		preview?: boolean;
	}) => Promise<{ chatTabId: string } | null>;
	openTurnDiffTab: (input: {
		label: string;
		/** Defaults to true; false opens a permanent tab the preview slot skips. */
		preview?: boolean;
		turnId: string;
	}) => Promise<{ chatTabId: string } | null>;
	openTerminalTab: (input: {
		harnessId: string;
		harnessLabel: string;
	}) => Promise<{ chatTabId: string } | null>;
	openWorkspaceFileDiffTab: (input: {
		filePath: string;
		/** Defaults to true; false opens a permanent tab the preview slot skips. */
		preview?: boolean;
		scope?: WorkspaceGitDiffScope;
	}) => Promise<{ chatTabId: string } | null>;
	/** Promotes an ephemeral preview tab to a permanent one. */
	pinSessionTab: (chatTabId: string) => void;
	closeSessionTabAsync: (
		chatTabId: string,
	) => Promise<{ replacementChatTabId: string | null }>;
}
