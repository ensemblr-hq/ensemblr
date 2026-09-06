import type {
	AfkModeChangedBroadcast,
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
import type {
	MenuBarDescriptor,
	MenuBarInvokeRequest,
} from '../../menu-bar.ts';
import type { MenuCommandBroadcast, MenuContext } from '../../menu-commands.ts';
import type { WindowChromeSnapshot } from '../../window-chrome.ts';
import type {
	ActiveChatContext,
	ChatTurnFinishedBroadcast,
	ConciergeVisibilityReport,
	FocusChatBroadcast,
} from './notifications.ts';
import type {
	ReviewBriefReply,
	ReviewBriefRequestedBroadcast,
} from './review-launch.ts';

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
	/**
	 * ISO timestamp of the snapshot this status was derived from. Lets a consumer
	 * that also holds the workspace's full snapshot tell which of the two observed
	 * GitHub more recently, so navigating between workspaces cannot show an older
	 * status than the one already on screen.
	 */
	syncedAt: string;
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

/** The window's maximized state, pushed on every change and returned by a toggle. */
export interface WindowMaximizedBroadcast {
	maximized: boolean;
}

/** Repository / workspace navigation tree IPC surface. */
export interface NavigationApi {
	repositoryWorkspaceNavigation: () => Promise<RepositoryWorkspaceNavigationSnapshot>;
}

/** Window/shell-level IPC surface (resize the BrowserWindow, etc). */
export interface ShellApi {
	/**
	 * Closes the BrowserWindow that issued the request. Goes through the window's
	 * own `close` event, so the quit guard still asks about running agents.
	 */
	closeWindow: () => Promise<void>;
	ensureWindowWidth: (minimumWidth: number) => Promise<void>;
	/** Minimizes the BrowserWindow that issued the request. */
	minimizeWindow: () => Promise<void>;
	/**
	 * Subscribes to the chrome the live window wears, which full screen changes
	 * under the shell: macOS takes its traffic lights away there, so the leading
	 * inset reserved for them has to go with them. Returns an unsubscribe function.
	 */
	onWindowChromeChanged: (
		listener: (snapshot: WindowChromeSnapshot) => void,
	) => () => void;
	/**
	 * Subscribes to the window's maximized state, so an app-drawn control shows
	 * what the window actually is rather than what it was last clicked to be —
	 * the compositor's own shortcuts change it too. Returns an unsubscribe function.
	 */
	onWindowMaximizedChanged: (
		listener: (payload: WindowMaximizedBroadcast) => void,
	) => () => void;
	/**
	 * Quits and starts this build again, draining running agents on the way out
	 * exactly as an ordinary quit does. Backs the settings that only
	 * `BrowserWindow`'s constructor reads.
	 */
	relaunchApp: () => Promise<void>;
	/**
	 * Maximizes the window, or restores it when it already is. Resolves with the
	 * state it left the window in.
	 */
	toggleMaximizeWindow: () => Promise<WindowMaximizedBroadcast>;
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
	 * Reads the menu bar as main last built it, so a renderer that draws the bar
	 * itself has one to paint before the next rebuild broadcasts.
	 */
	getMenuBar: () => Promise<MenuBarDescriptor>;
	/**
	 * Subscribes to the menu bar, rebroadcast whenever main rebuilds the native
	 * menu — a language change, or a renderer report that altered it. Returns an
	 * unsubscribe function.
	 */
	onMenuBarChanged: (
		listener: (payload: MenuBarDescriptor) => void,
	) => () => void;
	/**
	 * Performs the row the user picked in the app-drawn menu bar: main dispatches
	 * the command or carries out the Electron role behind it, exactly as a click
	 * on the native menu would.
	 */
	invokeMenuBarItem: (request: MenuBarInvokeRequest) => Promise<void>;
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
	 * Reports whether the Concierge panel is on screen, so a desktop notification
	 * for the Concierge is suppressed while the user is already reading it. Null
	 * is not a case — the panel is open or it is not. Fire-and-forget.
	 */
	reportConciergeVisibility: (
		report: ConciergeVisibilityReport,
	) => Promise<void>;
	/**
	 * Subscribes to Concierge notification clicks. Returns an unsubscribe
	 * function. There is one Concierge, so the request carries no payload — every
	 * window opens its own panel.
	 */
	onFocusConciergeRequested: (listener: () => void) => () => void;
	/**
	 * Subscribes to finished top-level turns, which is what the renderer marks a
	 * chat unread from. Returns an unsubscribe function. Every window receives it
	 * and the payload routinely names a workspace this window is not showing,
	 * which is the case the unread list exists for.
	 */
	onChatTurnFinished: (
		listener: (payload: ChatTurnFinishedBroadcast) => void,
	) => () => void;
	/**
	 * Subscribes to notification-sound requests, sent by the main process
	 * alongside a desktop notification it has already decided to show. Returns an
	 * unsubscribe function. The renderer owns the audio because the main process
	 * cannot play a bundled sound file, so there is no payload — main applied both
	 * the desktop-notification and notification-sound settings before sending.
	 */
	onNotificationSoundRequested: (listener: () => void) => () => void;
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
	 * Subscribes to review-prompt requests (an agent called `startReview` and main
	 * wants the prompt the Review button would compose). Returns an unsubscribe
	 * function. A window that holds no live model for the named workspace answers
	 * with an empty prompt, and main composes its own.
	 */
	onReviewBriefRequested: (
		listener: (payload: ReviewBriefRequestedBroadcast) => void,
	) => () => void;
	/** Answers a pending review-prompt request. */
	replyReviewBrief: (reply: ReviewBriefReply) => Promise<void>;
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
	/**
	 * Subscribes to AFK changes main made on the renderer's behalf, which today
	 * means a spawned conversation inheriting its parent's AFK state through the
	 * control layer. Returns an unsubscribe function. Mirrored into the per-chat
	 * toggle for the same reason {@link EnsemblrApi.onPlanModeChanged} is.
	 */
	onAfkModeChanged: (
		listener: (payload: AfkModeChangedBroadcast) => void,
	) => () => void;
	/** Opens an http/https URL in the user's default browser. */
	openExternal: (url: string) => Promise<void>;
}
