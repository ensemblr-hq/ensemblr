import type {
	AskUserQuestionBroadcast,
	AskUserQuestionClosedBroadcast,
	AskUserQuestionReply,
	BoardStatusBroadcast,
	ExitPlanModeBroadcast,
	FocusViewBroadcast,
	PlanModeChangedBroadcast,
	ReviewCommentsChangedBroadcast,
	TabsChangedBroadcast,
} from '../../agent-control.ts';
import type { MenuCommandBroadcast, MenuContext } from '../../menu-commands.ts';
import type { ActiveChatContext, FocusChatBroadcast } from './notifications.ts';

/** Open-ended metadata bag attached to a repository or workspace in the navigation tree. */
export interface RepositoryWorkspaceNavigationMetadata {
	[key: string]: unknown;
}

/**
 * Compact pull-request status a workspace sidebar row can render without the
 * full PR snapshot. `merged`/`closed` mirror the PR's GitHub state; the
 * remaining values collapse an OPEN PR's checks + mergeability into one signal.
 */
export type WorkspacePrPresentationStatus =
	| 'blocked'
	| 'checking'
	| 'closed'
	| 'merged'
	| 'open'
	| 'ready';

/** The compact PR presentation attached to a navigation workspace row. */
export interface WorkspacePrPresentation {
	number: number;
	status: WorkspacePrPresentationStatus;
}

/** A workspace entry in the repository/workspace navigation tree. */
export interface RepositoryWorkspaceNavigationWorkspace {
	archivedAt: string | null;
	baseBranch: string | null;
	branchName: string | null;
	createdAt: string;
	id: string;
	metadata: RepositoryWorkspaceNavigationMetadata;
	name: string;
	path: string;
	/**
	 * Compact PR status derived from the workspace's cached GitHub snapshot.
	 * Absent/null when no PR is cached (never fetched, or the branch has none).
	 * Lets the sidebar icon reflect real merge/checks state without the full
	 * snapshot.
	 */
	pullRequest?: WorkspacePrPresentation | null;
	repositoryId: string;
	slug: string;
	updatedAt: string;
}

/** A repository entry, with its child workspaces, in the navigation tree. */
export interface RepositoryWorkspaceNavigationRepository {
	createdAt: string;
	defaultBranch: string | null;
	id: string;
	metadata: RepositoryWorkspaceNavigationMetadata;
	name: string;
	path: string;
	slug: string;
	updatedAt: string;
	workspaces: RepositoryWorkspaceNavigationWorkspace[];
}

/** Full repository/workspace navigation tree snapshot. */
export interface RepositoryWorkspaceNavigationSnapshot {
	generatedAt: string;
	repositories: RepositoryWorkspaceNavigationRepository[];
}

/** Repository / workspace navigation tree IPC surface. */
export interface NavigationApi {
	repositoryWorkspaceNavigation: () => Promise<RepositoryWorkspaceNavigationSnapshot>;
}

/** Window/shell-level IPC surface (resize the BrowserWindow, etc). */
export interface ShellApi {
	/** Closes the BrowserWindow that issued the request. */
	closeWindow: () => Promise<void>;
	ensureWindowWidth: (minimumWidth: number) => Promise<void>;
	/**
	 * Subscribes to native application-menu commands, broadcast to the focused
	 * window when the user picks an item. Returns an unsubscribe function.
	 */
	onMenuCommand: (
		listener: (payload: MenuCommandBroadcast) => void,
	) => () => void;
	/**
	 * Reports which menu commands currently have a renderer handler, plus the
	 * entries filling the dynamic submenus, so the menu can disable what does not
	 * apply. Sent on registry changes; the main process rebuilds only on a real
	 * difference.
	 */
	reportMenuContext: (context: MenuContext) => Promise<void>;
	/**
	 * Subscribes to agent-control focus requests (an agent asked to bring a tab,
	 * dock terminal, or review panel to the foreground). Returns an unsubscribe
	 * function. The renderer applies it only for the window showing the payload's
	 * workspace.
	 */
	onAgentControlFocusView: (
		listener: (payload: FocusViewBroadcast) => void,
	) => () => void;
	/**
	 * Reports the chat currently on screen so the main process can suppress a
	 * desktop notification for that chat alone rather than for the whole app.
	 * Null when no chat is open. Fire-and-forget from the renderer.
	 */
	reportActiveChat: (context: ActiveChatContext | null) => Promise<void>;
	/**
	 * Subscribes to notification clicks (the user clicked a desktop notification
	 * for a finished or blocked chat). Returns an unsubscribe function. Every
	 * window receives it and the payload may name a workspace this window is not
	 * showing, so the handler navigates rather than filtering.
	 */
	onFocusChatRequested: (
		listener: (payload: FocusChatBroadcast) => void,
	) => () => void;
	/**
	 * Subscribes to agent-control tab-set changes (an agent opened or closed a
	 * tab). Returns an unsubscribe function. The renderer refreshes its tab list
	 * only for the window showing the payload's workspace.
	 */
	onAgentControlTabsChanged: (
		listener: (payload: TabsChangedBroadcast) => void,
	) => () => void;
	/**
	 * Subscribes to agent-control review-comment writes (an agent filed comments
	 * on a workspace diff). Returns an unsubscribe function. The renderer
	 * invalidates its cached comment list for the payload's workspace.
	 */
	onAgentControlReviewCommentsChanged: (
		listener: (payload: ReviewCommentsChangedBroadcast) => void,
	) => () => void;
	/**
	 * Subscribes to agent-control board-status requests (an agent moved its
	 * workspace on the kanban board). Returns an unsubscribe function. The
	 * renderer applies every payload to the global board-status atom.
	 */
	onAgentControlBoardStatus: (
		listener: (payload: BoardStatusBroadcast) => void,
	) => () => void;
	/**
	 * Reports the renderer's full board-status map to the main process so
	 * agent-control reads (`getWorkspaceStatus`, `listWorkspaces`) have a source.
	 * Fire-and-forget from the renderer's perspective.
	 */
	reportBoardStatus: (
		statusByWorkspaceId: Record<string, string>,
	) => Promise<void>;
	/**
	 * Subscribes to agent questionnaires (an agent called `askUserQuestion` and
	 * is blocked on the answer). Returns an unsubscribe function. The renderer
	 * shows each one in the chat tab bound to the payload's agent session.
	 */
	onAskUserQuestion: (
		listener: (payload: AskUserQuestionBroadcast) => void,
	) => () => void;
	/**
	 * Subscribes to questionnaire withdrawals (the asking session ended before the
	 * user answered). Returns an unsubscribe function.
	 */
	onAskUserQuestionClosed: (
		listener: (payload: AskUserQuestionClosedBroadcast) => void,
	) => () => void;
	/** Answers a pending questionnaire, unblocking the agent that asked it. */
	answerUserQuestion: (reply: AskUserQuestionReply) => Promise<void>;
	/**
	 * Subscribes to finished agent plans (an agent called `exitPlanMode` and
	 * ended its turn). Returns an unsubscribe function. The renderer shows each
	 * one in the chat tab bound to the payload's agent session, and owns the
	 * decision from there — nothing is waiting on an answer.
	 */
	onExitPlanMode: (
		listener: (payload: ExitPlanModeBroadcast) => void,
	) => () => void;
	/**
	 * Subscribes to Plan Mode changes main made on the renderer's behalf, which
	 * today means a spawned conversation inheriting its parent's Plan Mode through
	 * the control layer. Returns an unsubscribe function. The renderer mirrors each
	 * one into the per-chat toggle so the composer tells the truth and the user's
	 * next message does not clear a state they never set.
	 */
	onPlanModeChanged: (
		listener: (payload: PlanModeChangedBroadcast) => void,
	) => () => void;
	/** Opens an http/https URL in the user's default browser. */
	openExternal: (url: string) => Promise<void>;
}
