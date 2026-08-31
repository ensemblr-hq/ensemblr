import type { AgentActionKind } from './agent-actions';
import type { ReviewFilePreviewOpener } from './file-preview';
import type { OpenTargetsState } from './open-targets';
import type { ReviewFileSummary, WorkspaceOpenTarget } from './workspace';

/**
 * Review-flow actions shared by the right sidebar header and the Checks panel.
 * Provided by `ReviewActionsProvider` at the workspace shell level so any
 * review surface can open the merge confirmation, force a gh refresh, or run an
 * agent action. PR creation is handed to the chat agent (see
 * `CreatePullRequestMenu`), so it is no longer a context action.
 */
export interface ReviewActionsValue {
	/** Archives the merged workspace from the post-merge header action. */
	archiveMergedWorkspace: () => void;
	/** Asks the chat agent to stage, commit, and push everything in the worktree. */
	commitAndPush: () => void;
	/**
	 * Branches the workspace onto a `-v<n>` successor of its current branch from
	 * the post-merge header action, so work continues without the merged pull
	 * request trailing along.
	 */
	continueMergedWorkspace: () => void;
	/** Whether the merged workspace archive action is currently running. */
	isArchivingMergedWorkspace: boolean;
	/**
	 * Whether any agent attached to the workspace is mid-turn. Every review
	 * surface freezes its actions while this is true, because the agent is about
	 * to change the state those actions would act on.
	 */
	isAgentWorking: boolean;
	/** Whether the merged workspace continue action is currently running. */
	isContinuingMergedWorkspace: boolean;
	/** Whether the direct branch push is currently running. */
	isPushingBranch: boolean;
	isRefreshingPullRequest: boolean;
	openMergeConfirmation: () => void;
	/**
	 * What the pull-request button will actually do, so a surface labels itself
	 * and reports what it asked for without re-deriving the answer. Every surface
	 * fires `create-pr` and {@link runAgentAction} reroutes an open pull request
	 * to `update-pr`; this is that same verdict, published.
	 */
	pullRequestAction: Extract<AgentActionKind, 'create-pr' | 'update-pr'>;
	/** Pushes the branch with git, skipping the agent. */
	pushBranch: () => void;
	refreshPullRequest: () => void;
	/** Inserts the resolved agent-action prompt into the composer (ENS-059). */
	runAgentAction: (action: AgentActionKind) => void;
}

/**
 * Per-row actions shared by every changed-file row and the single right-click
 * menu. Carried through React context rather than props because the folder tree
 * is recursive — threading five callbacks through every `ReviewDirectoryBranch`
 * would be noise, and the bundle is stable for the lifetime of a change set.
 */
export interface ReviewFileActions {
	/** Installed "Open in <app>" targets (copy-path excluded), or empty when none. */
	openInTargets: readonly WorkspaceOpenTarget[];
	/** The copy-path target, if available. */
	copyTarget: WorkspaceOpenTarget | undefined;
	/** Runs the chosen open-in/copy target against a workspace-relative file path. */
	invokeTarget: OpenTargetsState['invokeTarget'];
	/**
	 * Opens (or re-focuses) the surface that shows a changed file: the image
	 * preview when the workspace still holds a previewable image, otherwise the
	 * diff at the active source's scope. `null` outside a conversation.
	 */
	openFile: ReviewFilePreviewOpener | null;
	/** Discards the working-tree changes for a single file. */
	onDiscardFile: (filePath: string) => void;
	/**
	 * Attaches one file's patch to the workspace's composer as a chip. The patch is
	 * taken at the active source's scope, so a row listed from a commit attaches
	 * that commit's diff rather than the working tree's.
	 */
	attachDiff: (filePath: string) => void;
	/**
	 * Whether a file can be discarded in the current view. Only working-tree
	 * (uncommitted) files revert cleanly; committed-only files in the branch or
	 * a specific-commit view are not discardable.
	 */
	isDiscardable: (filePath: string) => boolean;
	/**
	 * Whether the reviewer marked this row viewed at the state it currently shows.
	 * Takes the whole row because the answer expires when the file changes again.
	 */
	isViewed: (file: ReviewFileSummary) => boolean;
}

/** The changed file a right-click opened the shared menu against. */
export interface ReviewFileMenuTarget {
	path: string;
}

/** The file/folder a right-click opened the shared tree menu against. */
export interface FileTreeMenuTarget {
	relativePath: string;
	relativePathKind: 'directory' | 'file';
}

/** What a confirmed discard will revert. */
export interface DiscardChangesTarget {
	/** Number of distinct changed files (drives single vs bulk copy). */
	fileCount: number;
	/**
	 * Workspace-relative paths to discard. For a rename this carries both the new
	 * path and its `renamedFrom` so the original is restored alongside.
	 */
	paths: string[];
	/** Human label: a file name, or e.g. "all 8 changes". */
	title: string;
}
