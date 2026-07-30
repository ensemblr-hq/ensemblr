/**
 * Ports the agent-control service delegates to. Each port is a narrow interface
 * over an existing main-process service, so the service stays decoupled and
 * unit-testable; concrete adapters wire these to the real chat-tab, Pi session,
 * terminal, script, and harness services at composition time.
 */
import type {
	AgentControlConversationStatus,
	AgentControlModelList,
	AgentControlTabInfo,
	AgentControlTerminalInfo,
	AgentControlWorkspaceInfo,
	AskUserQuestionItem,
	AskUserQuestionResult,
	ExitPlanModeArgs,
	ExitPlanModeResult,
	FocusPanelName,
	OpenTabVariant,
	SessionBriefNaming,
	SetBranchNameResult,
	SetSummaryResult,
	StartTerminalKind,
	WorkspaceBoardStatusValue,
} from '../../shared/agent-control.ts';
import type { PermissionMode } from '../../shared/permissions.ts';

/** Which agent species a control command originated from. */
export type AgentSpecies = 'pi' | 'harness';

/**
 * Identity of an agent being spawned, resolved into a control-env overlay. Pi
 * sessions pass their real per-session id and the spawning session's id so
 * lineage (depth, deadlock) guardrails work; harness/terminal launches pass a
 * workspace-scoped id with `species: 'harness'`.
 */
export interface AgentControlEnvIdentity {
	workspaceId: string;
	sessionId: string;
	parentSessionId?: string | null;
	species?: AgentSpecies;
}

/**
 * Resolves the agent-control env overlay (control-server URL + a freshly minted
 * per-session token) for a spawning agent. Registers the origin as a side
 * effect. Returns an empty object when the control layer is unavailable.
 */
export type AgentControlEnvResolver = (
	identity: AgentControlEnvIdentity,
) => Record<string, string>;

/**
 * Resolved, trusted identity of a control command's caller. Minted at agent
 * spawn and looked up from the injected token; never assembled from
 * agent-supplied fields. Drives scope, permission mode, and lineage guardrails.
 */
export interface AgentControlOrigin {
	token: string;
	sessionId: string;
	workspaceId: string;
	workspaceCwd: string;
	parentSessionId: string | null;
	depth: number;
	species: AgentSpecies;
}

/** Lists workspaces for the cross-workspace read ops. */
export interface WorkspacePort {
	listWorkspaces: () => Promise<readonly AgentControlWorkspaceInfo[]>;
}

/** Chat/terminal tab operations plus the reads needed to scope-check them. */
export interface TabPort {
	spawnChatTab: (input: {
		workspaceId: string;
		title?: string;
	}) => Promise<{ chatTabId: string }>;
	closeTab: (input: { chatTabId: string }) => Promise<void>;
	openNonChatTab: (input: {
		workspaceId: string;
		variant: OpenTabVariant;
		filePath?: string;
		turnId?: string;
		commentBody?: string;
		prNumber?: number;
	}) => Promise<{ chatTabId: string }>;
	listTabs: (input: {
		workspaceId: string;
	}) => Promise<readonly AgentControlTabInfo[]>;
	/** Owning workspace of a tab, or null when it does not exist. */
	resolveTabWorkspace: (chatTabId: string) => Promise<string | null>;
}

/** Pi conversation lifecycle plus its scope-check and read helpers. */
export interface ConversationPort {
	startConversation: (input: {
		workspaceId: string;
		workspaceCwd: string;
		chatTabId?: string;
		prompt: string;
		model?: string;
		thinkingLevel?: string;
		/** Descriptive name applied to the new conversation's tab via Pi `/name`. */
		title?: string;
		/**
		 * The spawning (master) agent's own model, used as a fallback when no valid
		 * `model` is requested so a Pi child inherits the master's model rather than
		 * a hallucinated one. Only Pi callers provide it.
		 */
		callerModel?: string;
		/** Caller session id, threaded into the child's spawn env for lineage. */
		parentSessionId: string;
		/**
		 * Whether the child starts in Plan Mode, snapshotted from the spawning agent
		 * at spawn time; the child owns the flag afterwards. Required rather than
		 * optional so a future second spawn route cannot silently produce an
		 * unrestricted child from a planning parent.
		 */
		planMode: boolean;
	}) => Promise<{ chatTabId: string; piSessionId: string }>;
	/** Lists the available Pi models plus the default, for model selection. */
	listModels: () => Promise<AgentControlModelList>;
	sendFollowUp: (input: {
		piSessionId: string;
		prompt: string;
	}) => Promise<void>;
	/**
	 * Sets the display name of an active conversation's tab (Pi `/name`).
	 * Resolves null when the session is not active, and `applied: false` when the
	 * user owns the title and the rename was declined.
	 */
	setName: (input: {
		piSessionId: string;
		name: string;
	}) => Promise<{ applied: boolean; chatTabId: string; title: string } | null>;
	/** Resolves once the session goes idle, or `'timeout'` after `timeoutMs`. */
	waitForIdle: (
		piSessionId: string,
		timeoutMs: number,
	) => Promise<'completed' | 'timeout'>;
	/**
	 * Live conversation status. Reads the in-memory snapshot only, with no
	 * persisted-event scan, so the `waitForAgents` poll loop can call it every
	 * tick; pair it with {@link ConversationPort.hasFinalMessage} when a caller
	 * needs the full {@link AgentControlConversationStatus}.
	 */
	getStatus: (
		piSessionId: string,
	) => Promise<Omit<AgentControlConversationStatus, 'hasFinalMessage'> | null>;
	/**
	 * Whether a persisted assistant answer exists for the conversation. Scans
	 * stored events, so it stays off the poll loop and is resolved only for the
	 * callers that report the flag.
	 */
	hasFinalMessage: (piSessionId: string) => Promise<boolean>;
	/**
	 * The conversation's report: every assistant message of its newest answered
	 * turn, joined, or null when it has produced none. A whole turn rather than a
	 * single message so an agent that signs off after its findings does not
	 * shadow them.
	 */
	getLastMessage: (piSessionId: string) => Promise<string | null>;
	/**
	 * Whether a Pi session's chat tab carries the sub-agent marker its spawn
	 * persisted. Role resolution needs a signal that outlives the process: a
	 * caller's `parentSessionId` is never stored, so a conversation resumed after
	 * a restart re-registers at depth 0, while its Plan Mode comes back from the
	 * renderer's per-tab store — lineage alone would hand a restored investigator
	 * the orchestrator policy. An implementation that cannot read the marker
	 * reports false rather than throwing, which leaves the role to depth exactly
	 * as it was before the marker existed.
	 */
	isSpawnedSubAgent: (piSessionId: string) => Promise<boolean>;
	/** Owning workspace of a Pi session, or null when it does not exist. */
	resolveConversationWorkspace: (piSessionId: string) => Promise<string | null>;
}

/** Dock terminal operations plus their scope-check and read helpers. */
export interface TerminalPort {
	startTerminal: (input: {
		workspaceId: string;
		workspaceCwd: string;
		kind: StartTerminalKind;
	}) => Promise<{ terminalId: string }>;
	stopTerminal: (input: {
		workspaceId: string;
		terminalId?: string;
		kind?: 'setup' | 'run';
	}) => Promise<void>;
	writeTerminal: (input: {
		terminalId: string;
		input: string;
	}) => Promise<void>;
	readOutput: (terminalId: string) => Promise<string | null>;
	listTerminals: (input: {
		workspaceId: string;
	}) => Promise<readonly AgentControlTerminalInfo[]>;
	/** Owning workspace of a terminal, or null when it does not exist. */
	resolveTerminalWorkspace: (terminalId: string) => Promise<string | null>;
}

/** Launches a third-party harness into a new terminal tab. */
export interface HarnessPort {
	launchHarness: (input: {
		workspaceId: string;
		harnessId: string;
		/** Caller session id, threaded into the child's spawn env for lineage. */
		parentSessionId: string;
	}) => Promise<{ chatTabId: string; terminalId: string }>;
}

/**
 * Brings a view to the foreground by broadcasting a focus request to the
 * renderer window showing the workspace. Focus is renderer state (active
 * tab/panel), so this is the only port that reaches back to the UI.
 */
export interface FocusPort {
	focusTab: (input: { workspaceId: string; chatTabId: string }) => void;
	focusDockTab: (input: { workspaceId: string; dock: string }) => void;
	focusPanel: (input: { workspaceId: string; panel: FocusPanelName }) => void;
}

/**
 * Reads and writes a workspace's kanban board status. Writes broadcast to the
 * renderer (which owns the board-status atom) and update the main-side mirror
 * optimistically; reads serve from that mirror.
 */
export interface BoardPort {
	setWorkspaceStatus: (input: {
		workspaceId: string;
		status: WorkspaceBoardStatusValue;
	}) => void;
	getWorkspaceStatus: (workspaceId: string) => WorkspaceBoardStatusValue;
}

/**
 * Resolves the active permission mode. The mode is a global app setting (the
 * same value the IPC permission gate reads), so it takes no workspace argument.
 */
export interface PermissionPort {
	getMode: () => PermissionMode;
}

/**
 * Surfaces a confirmation to the human when the mode requires approval. Returns
 * true when approved. Harnesses have no native confirm channel, so this drives
 * Ensemblr's own UI regardless of the caller's species.
 */
export interface ConfirmPort {
	confirm: (input: {
		origin: AgentControlOrigin;
		summary: string;
	}) => Promise<boolean>;
}

/**
 * Puts an agent's questionnaire to the human and resolves once they answer or
 * dismiss it. The call blocks the agent's turn for as long as the dialog is up,
 * which is the point: the agent asked because it cannot proceed without a
 * decision.
 */
export interface AskPort {
	ask: (input: {
		origin: AgentControlOrigin;
		questions: readonly AskUserQuestionItem[];
	}) => Promise<AskUserQuestionResult>;
	/** Cancels every questionnaire still pending for a session that ended. */
	releaseSession: (sessionId: string) => void;
}

/**
 * Reads a session's Plan Mode state and hands its finished plan to the user.
 * `exit` returns as soon as the plan is saved and surfaced — it does not wait
 * for a decision, so the agent's turn ends with the plan as its last message.
 */
export interface PlanModePort {
	isActive: (sessionId: string) => boolean;
	exit: (input: {
		origin: AgentControlOrigin;
		args: ExitPlanModeArgs;
	}) => Promise<ExitPlanModeResult>;
	/**
	 * Puts a freshly spawned child into Plan Mode, so a planning parent's
	 * delegation stays read-only. Deliberately one-way: this port is reachable
	 * from every control handler, and a member that could turn Plan Mode *off*
	 * would be a route for a future op to unblock its own session, contradicting
	 * the promise the agent is given that only the user's approval ends planning.
	 */
	activateForSpawn: (sessionId: string) => void;
	/** Forgets a session's Plan Mode state once it ends. */
	releaseSession: (sessionId: string) => void;
}

/**
 * Reads and writes the caller's own session identity: the per-turn upkeep
 * brief, the one-shot workspace/branch naming, and the tab's session summary.
 * Separate from {@link TabPort} (id plumbing for scope checks) and
 * {@link ConversationPort} (Pi lifecycle) because neither should grow workspace
 * metadata or git-rename responsibilities. Every operation resolves the
 * caller's tab and branch from its origin rather than taking them as arguments.
 */
export interface SessionNamingPort {
	/** Best-effort: an unresolvable caller reports nothing outstanding. */
	readBrief: (origin: AgentControlOrigin) => Promise<SessionBriefNaming>;
	/**
	 * One-shot naming of the workspace and its git branch. Gated on the user's
	 * "Let agents name the workspace and branch" setting as well as the
	 * placeholder-name check: with the setting off nothing is renamed and the
	 * result comes back `applied: false`, however insistently the agent asks.
	 */
	setBranchName: (input: {
		origin: AgentControlOrigin;
		slug: string;
	}) => Promise<SetBranchNameResult>;
	setSummary: (input: {
		origin: AgentControlOrigin;
		title: string;
		summary: string;
	}) => Promise<SetSummaryResult>;
}

/** All collaborators the agent-control service composes. */
export interface AgentControlPorts {
	ask: AskPort;
	planMode: PlanModePort;
	sessionNaming: SessionNamingPort;
	workspaces: WorkspacePort;
	tabs: TabPort;
	conversations: ConversationPort;
	terminals: TerminalPort;
	harnesses: HarnessPort;
	focus: FocusPort;
	board: BoardPort;
	permissions: PermissionPort;
	confirm: ConfirmPort;
}
