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
	/** Opens the detected dev-server preview URL in the system browser. */
	onOpenRunPort: (url: string) => void;
	onOpenSetupScripts: () => void;
	onRunScript: () => void;
	onRunSetupScript: () => void;
	onStopRunScript: () => void;
	onStopSetupScript: () => void;
}

export type ChangesViewMode = 'folders' | 'list';

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
 * Extended session-tab state surface — adds async open/close handlers used by
 * the conversation-panel SessionTabs to drive routing on mutation success.
 */
export interface SessionTabActions {
	openSessionTab: () => Promise<{ chatTabId: string } | null>;
	openCommentPreviewTab: (input: {
		comment: PullRequestCommentSummary;
		prNumber?: number;
	}) => Promise<{ chatTabId: string } | null>;
	openFilePreviewTab: (input: {
		filePath: string;
	}) => Promise<{ chatTabId: string } | null>;
	openTurnDiffTab: (input: {
		label: string;
		turnId: string;
	}) => Promise<{ chatTabId: string } | null>;
	openTerminalTab: (input: {
		harnessId: string;
		harnessLabel: string;
	}) => Promise<{ chatTabId: string } | null>;
	openWorkspaceFileDiffTab: (input: {
		filePath: string;
		scope?: WorkspaceGitDiffScope;
	}) => Promise<{ chatTabId: string } | null>;
	closeSessionTabAsync: (
		chatTabId: string,
	) => Promise<{ replacementChatTabId: string | null }>;
}
