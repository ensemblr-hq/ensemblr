/**
 * Cross-process contract for the agent → app control layer ("Ensemblr Control").
 *
 * Agents running inside Ensemblr (first-party Pi, and third-party harnesses over
 * MCP) invoke these operations to drive the app: spawn chat tabs, start
 * conversations, launch harnesses, and start/stop dock terminals. Both bridges
 * funnel into one main-process service that validates, scopes, gates, and
 * delegates. The op names are namespaced `ensemblr.<op>` on the wire; this module
 * defines the bare op identifiers and their argument/result shapes.
 */

/** Every control operation an agent may request, read and write alike. */
export const AGENT_CONTROL_OPS = [
	'spawnChatTab',
	'startConversation',
	'sendFollowUp',
	'setName',
	'setBranchName',
	'setSummary',
	'closeTab',
	'launchHarness',
	'startTerminal',
	'stopTerminal',
	'writeTerminal',
	'openTab',
	'focusTab',
	'focusDockTab',
	'focusPanel',
	'setWorkspaceStatus',
	'getWorkspaceStatus',
	'listWorkspaces',
	'listTabs',
	'listTerminals',
	'getConversationStatus',
	'getLastMessage',
	'readTerminalOutput',
	'listModels',
	'waitForAgents',
	'notifyOrchestrator',
	'askUserQuestion',
	'getSessionBrief',
	'checkPlanModeTool',
	'exitPlanMode',
] as const;

/**
 * The kanban board statuses an agent may set on its workspace, in column order.
 * Canonical source of the board vocabulary: the renderer's `WorkspaceBoardStatus`
 * and `BOARD_STATUS_ORDER` (`src/renderer/state/workspace/board-status.ts`) derive
 * from this, so there is one list to keep in sync.
 */
export const WORKSPACE_BOARD_STATUSES = [
	'backlog',
	'in-progress',
	'in-review',
	'done',
	'canceled',
] as const;

/** A single kanban board status value. */
export type WorkspaceBoardStatusValue =
	(typeof WORKSPACE_BOARD_STATUSES)[number];

/** A single control operation identifier. */
export type AgentControlOp = (typeof AGENT_CONTROL_OPS)[number];

/**
 * Operations that mutate app state. Everything else is a read. Writes are scoped
 * to the caller's own workspace and follow the permission mode; reads are always
 * allowed and may span workspaces.
 *
 * `exitPlanMode` writes a plan file yet is deliberately absent: it is the only
 * exit from Plan Mode, so gating it would strand a planning agent with every
 * editing tool denied and no way out. It is gated on active Plan Mode instead.
 */
const WRITE_OPS: ReadonlySet<AgentControlOp> = new Set([
	'spawnChatTab',
	'startConversation',
	'sendFollowUp',
	'setName',
	'setBranchName',
	'setSummary',
	'closeTab',
	'launchHarness',
	'startTerminal',
	'stopTerminal',
	'writeTerminal',
	'openTab',
	'focusTab',
	'focusDockTab',
	'focusPanel',
	'setWorkspaceStatus',
]);

/**
 * Operations that create a new tab/terminal/conversation and therefore count
 * against the caller's spawn quota and nesting depth.
 */
const SPAWN_OPS: ReadonlySet<AgentControlOp> = new Set([
	'spawnChatTab',
	'startConversation',
	'launchHarness',
	'startTerminal',
	'openTab',
]);

/**
 * Reports whether an operation mutates app state.
 * @param op - Operation to classify.
 * @returns True for writes, false for reads.
 */
export function isWriteOp(op: AgentControlOp): boolean {
	return WRITE_OPS.has(op);
}

/**
 * Reports whether an operation spawns a new resource (subject to depth and quota
 * guardrails).
 * @param op - Operation to classify.
 * @returns True when the op creates a tab, terminal, or conversation.
 */
export function isSpawnOp(op: AgentControlOp): boolean {
	return SPAWN_OPS.has(op);
}

/** Thinking-level tokens Pi accepts, kept loose as a string on the wire. */
export type AgentControlThinkingLevel = string;

/** Args for `spawnChatTab`: open an empty chat tab in the caller's workspace. */
export interface SpawnChatTabArgs {
	title?: string;
}

/** Args for `startConversation`: open (or reuse) a chat tab and submit a first prompt. */
export interface StartConversationArgs {
	chatTabId?: string;
	prompt: string;
	model?: string;
	thinkingLevel?: AgentControlThinkingLevel;
	/** Short, descriptive name for the new conversation's tab (Pi `/name`). */
	title?: string;
	/** Block until the child conversation completes, subject to the wait timeout. */
	wait?: boolean;
}

/** Args for `setName`: set the display name of the caller's own conversation tab. */
export interface SetNameArgs {
	name: string;
}

/**
 * Result of `setName`. A tab the user named themselves is left alone rather
 * than failing the call, so the agent reads "already settled" instead of a
 * retryable error.
 */
export interface SetNameResult {
	applied: boolean;
	title: string;
	message: string;
}

/**
 * Ceiling on the raw `setBranchName` argument. Only a runaway guard:
 * `sanitizeBranchSlug` already truncates to the real branch-name limit at a
 * word boundary, so this rejects a generation that never stopped.
 */
export const SET_BRANCH_NAME_LIMITS = {
	maxRawLength: 120,
} as const;

/** Args for `setBranchName`: name the caller's workspace and its git branch. */
export interface SetBranchNameArgs {
	/** Kebab-case slug describing the work, e.g. `add-dark-mode`. */
	name: string;
}

/**
 * Result of `setBranchName`. Naming is one-shot — a workspace the user (or an
 * earlier agent) already named reports `applied: false` rather than failing, so
 * the agent stops retrying instead of treating it as a transient fault.
 */
export interface SetBranchNameResult {
	applied: boolean;
	/** The workspace's display name after the call, applied or not. */
	name: string;
	/** The git branch after the call, or null when the workspace has none. */
	branchName: string | null;
	message: string;
}

/**
 * Upper bounds on a `setSummary` submission. The title labels a file chip and a
 * markdown heading, so it matches the plan-title ceiling; the body sits
 * deliberately below the transcript cap, since a session record that grows to
 * transcript size has stopped being a summary.
 */
export const SET_SUMMARY_LIMITS = {
	maxSummaryLength: 4_000,
	maxTitleLength: 80,
} as const;

/** Args for `setSummary`: record what this conversation has covered so far. */
export interface SetSummaryArgs {
	/** Short topic line, rendered as the summary's heading. */
	title: string;
	/** The summary body, in markdown. */
	summary: string;
}

/**
 * Result of `setSummary`. The point in the conversation the summary covers is
 * echoed back, so a later fork can tell whether the record predates the turn it
 * is forking from.
 */
export interface SetSummaryResult {
	capturedAtOrdinal: number;
	message: string;
}

/** Args for `sendFollowUp`: submit a follow-up prompt into an existing conversation. */
export interface SendFollowUpArgs {
	piSessionId: string;
	prompt: string;
	wait?: boolean;
}

/** Args for `closeTab`: close a chat/terminal tab the caller owns. */
export interface CloseTabArgs {
	chatTabId: string;
}

/** Args for `launchHarness`: open a terminal tab running a third-party harness. */
export interface LaunchHarnessArgs {
	harnessId: string;
}

/** Kinds of dock terminal an agent may start. */
export type StartTerminalKind = 'setup' | 'run' | 'spawn';

/** Args for `startTerminal`: start a dock terminal (setup/run script or interactive spawn). */
export interface StartTerminalArgs {
	kind: StartTerminalKind;
}

/** Args for `stopTerminal`: stop a dock terminal by id, or a script terminal by kind. */
export interface StopTerminalArgs {
	terminalId?: string;
	kind?: 'setup' | 'run';
}

/** Args for `writeTerminal`: write input into an existing terminal or harness. */
export interface WriteTerminalArgs {
	terminalId: string;
	input: string;
}

/** Non-chat tab variants an agent may surface to the user. */
export type OpenTabVariant = 'file' | 'diff' | 'comment';

/** Args for `openTab`: open a file preview, diff, or comment-preview tab. */
export interface OpenTabArgs {
	variant: OpenTabVariant;
	filePath?: string;
	turnId?: string;
	commentBody?: string;
	prNumber?: number;
}

/** Args for `listTabs`: list tabs, defaulting to the caller's workspace. */
export interface ListTabsArgs {
	workspaceId?: string;
}

/** Args for `listTerminals`: list terminals, defaulting to the caller's workspace. */
export interface ListTerminalsArgs {
	workspaceId?: string;
}

/** Args for `getConversationStatus` / `getLastMessage`: target a Pi session. */
export interface ConversationRef {
	piSessionId: string;
}

/** Args for `readTerminalOutput`: read a terminal's current scrollback. */
export interface ReadTerminalOutputArgs {
	terminalId: string;
}

/** How a blocking wait returns: on the first child, or once all have settled. */
export type WaitMode = 'first' | 'all';

/**
 * How much of each child's report a wait returns. `full` hands back the whole
 * final turn; `brief` keeps the opening of it and points at
 * `getLastMessage` for the rest, so a wide fan-out costs the orchestrator's
 * context once rather than once per child.
 */
export type WaitReportDetail = 'full' | 'brief';

/**
 * Args for `waitForAgents`: block the caller's turn until delegated Pi children
 * finish or need a decision. `targets` defaults to every live child of the
 * caller; `mode` defaults to `'first'`; `reports` defaults to `'full'`;
 * `timeoutMs` is clamped to the app's wait timeout.
 */
export interface WaitForAgentsArgs {
	targets?: string[];
	mode?: WaitMode;
	reports?: WaitReportDetail;
	timeoutMs?: number;
}

/** Why a spawned child pinged its orchestrator via `notifyOrchestrator`. */
export type OrchestratorSignalReason =
	| 'need_decision'
	| 'blocked'
	| 'progress'
	| 'done';

/** A pending child→orchestrator signal, surfaced back through `waitForAgents`. */
export interface OrchestratorSignal {
	reason: OrchestratorSignalReason;
	message: string;
}

/** One settled (or attention-needing) child, as reported by `waitForAgents`. */
export interface WaitedAgent {
	piSessionId: string;
	status: string;
	lastMessage: string | null;
	/** The child's pending signal when it woke the wait, else null. */
	signal: OrchestratorSignal | null;
	/** Whether `lastMessage` was shortened and the rest is still fetchable. */
	reportTruncated: boolean;
}

/** A target that had not settled when `waitForAgents` returned. */
export interface PendingAgent {
	piSessionId: string;
	status: string;
}

/**
 * Result of `waitForAgents`: the children that settled, the ones still running,
 * and whether it timed out. `pending` spares the caller a status poll per child
 * when the wait returns before every target is done — on `mode: "first"`, on a
 * signal, or on a timeout.
 */
export interface WaitForAgentsResult {
	completed: readonly WaitedAgent[];
	pending: readonly PendingAgent[];
	timedOut: boolean;
}

/**
 * Args for `notifyOrchestrator`: a spawned child pulls its orchestrator back.
 * `need_decision`/`blocked` wake a pending `waitForAgents`; `progress`/`done`
 * are informational.
 */
export interface NotifyOrchestratorArgs {
	reason: OrchestratorSignalReason;
	message: string;
}

/**
 * Upper bounds on an `askUserQuestion` questionnaire. The counts are small on
 * purpose: the dialog is a decision aid, not a form, and every option must stay
 * reachable by a single number key. `maxHeaderLength` is a trim point rather
 * than a rejection — the header is only ever a pager dot's accessible name, so
 * losing a questionnaire over it costs the agent a round trip and buys nothing.
 */
export const ASK_USER_QUESTION_LIMITS = {
	maxQuestions: 4,
	maxOptions: 6,
	minOptions: 2,
	maxHeaderLength: 64,
	maxLabelLength: 80,
} as const;

/**
 * Option labels the dialog reserves for its own rows, so an agent cannot render
 * a choice indistinguishable from the free-text row.
 */
export const ASK_USER_QUESTION_RESERVED_LABELS = [
	'other',
	'next',
	'type something',
	'type something…',
	'type something...',
] as const;

/** One selectable choice within an `askUserQuestion` question. */
export interface AskUserQuestionOption {
	label: string;
	/** Trade-off or consequence shown under the label. */
	description?: string;
}

/** A single question in an `askUserQuestion` questionnaire. */
export interface AskUserQuestionItem {
	question: string;
	/** Accessible name for this question's pager dot, appended to its `Q<n>` position. */
	header?: string;
	options: readonly AskUserQuestionOption[];
	/** Lets the user check several options instead of picking one. */
	multiSelect?: boolean;
}

/** Args for `askUserQuestion`: put one or more choices to the human. */
export interface AskUserQuestionArgs {
	questions: readonly AskUserQuestionItem[];
}

/**
 * How a question was answered: a picked option, free text typed by the user, or
 * a multi-select set.
 */
export type AskUserQuestionAnswerKind = 'option' | 'custom' | 'multi';

/** One answered question, in the order the questions were asked. */
export interface AskUserQuestionAnswer {
	questionIndex: number;
	question: string;
	kind: AskUserQuestionAnswerKind;
	/** The single chosen label or typed text; null for a multi-select answer. */
	answer: string | null;
	/** Chosen labels when `kind` is `multi`. */
	selected?: readonly string[];
}

/**
 * Result of `askUserQuestion`. Unanswered questions are simply absent, so a
 * partial submission is a normal success. `cancelled` marks a dismissed dialog —
 * the agent should treat it as "the user declined", not as an error.
 */
export interface AskUserQuestionResult {
	answers: readonly AskUserQuestionAnswer[];
	cancelled: boolean;
	/** Prose rendering of `answers`, so the model reads intent rather than JSON. */
	summary: string;
}

/**
 * Main → renderer request to put an agent's questionnaire to the user. The
 * renderer shows it only in the chat tab bound to `piSessionId`, so a question
 * is answered in the conversation that asked it.
 */
export interface AskUserQuestionBroadcast {
	requestId: string;
	workspaceId: string;
	piSessionId: string;
	questions: readonly AskUserQuestionItem[];
}

/**
 * Main → renderer signal that a pending questionnaire is no longer answerable
 * (its session ended or the app is tearing it down), so the renderer drops it.
 */
export interface AskUserQuestionClosedBroadcast {
	requestId: string;
}

/**
 * Renderer → main answer to a pending questionnaire. Carries only what the user
 * did; main renders the model-facing summary itself, so the prose an agent acts
 * on can never disagree with the answers behind it.
 */
export interface AskUserQuestionReply {
	requestId: string;
	answers: readonly AskUserQuestionAnswer[];
	cancelled: boolean;
}

/**
 * Upper bounds on an `exitPlanMode` submission. The title labels a review panel
 * and a filename stem, so it stays short; the plan itself is a full markdown
 * document and only needs a ceiling that keeps a runaway generation from
 * filling the user's disk.
 */
export const EXIT_PLAN_MODE_LIMITS = {
	maxPlanLength: 60_000,
	maxTitleLength: 80,
} as const;

/** Args for `exitPlanMode`: hand the finished plan to the user for review. */
export interface ExitPlanModeArgs {
	/** Short label for the review panel and the saved plan's filename. */
	title: string;
	/** The full plan, in markdown. */
	plan: string;
}

/**
 * Result of `exitPlanMode`. The call does not wait for the user: it saves the
 * plan, surfaces the review, and tells the agent to stop, so the plan stays the
 * last message in the conversation while the user decides. What they choose
 * reaches the agent as its next prompt, not as this result.
 */
export interface ExitPlanModeResult {
	planPath: string | null;
	summary: string;
}

/**
 * Main → renderer request to put a finished plan to the user. The renderer
 * shows it only in the chat tab bound to `piSessionId`, so a plan is reviewed
 * in the conversation that wrote it. Carries no plan body: the app posts the
 * plan into that tab's timeline as a separate assistant message, so this
 * broadcast only needs the title and saved path — shipping the plan again here
 * would duplicate it on screen.
 */
export interface ExitPlanModeBroadcast {
	requestId: string;
	workspaceId: string;
	piSessionId: string;
	title: string;
	/** Workspace-relative path of the saved plan, or null when the write failed. */
	planPath: string | null;
}

/**
 * Main → renderer notice that a chat tab's Plan Mode state changed underneath the
 * renderer. A spawned conversation inherits its parent's Plan Mode through the
 * control layer, which bypasses the IPC handlers the renderer's own toggle rides,
 * so without this push the child's composer would show the toggle off while its
 * tools are blocked — and the user's next message would clear the inherited state.
 * Keyed by chat tab, because that is what the renderer's per-chat toggle is keyed
 * by. Enforcement never depends on this landing: the registry is written first and
 * this is a best-effort mirror.
 */
export interface PlanModeChangedBroadcast {
	workspaceId: string;
	chatTabId: string;
	piSessionId: string;
	planMode: boolean;
}

/** Args for `checkPlanModeTool`: ask whether a tool call is allowed while planning. */
export interface CheckPlanModeToolArgs {
	tool: string;
	/** The command a `bash` call would run; absent for other tools. */
	command?: string;
}

/**
 * The upkeep the calling session still owes, as reported by `getSessionBrief`.
 * Each flag clears once the corresponding tool has been called, which is what
 * lets the nudge built from it fall silent instead of repeating every turn.
 */
export interface SessionBriefNaming {
	/** The tab still carries a title derived from the prompt, not chosen. */
	titleNeeded: boolean;
	branch: {
		/** The workspace still has its generated placeholder name. */
		eligible: boolean;
		/** The workspace's current git branch, or null when it has none. */
		current: string | null;
	};
	/** Turns have landed since the recorded summary was written. */
	summaryStale: boolean;
}

/**
 * Result of `getSessionBrief`: everything the Pi extension needs to assemble
 * this turn's system prompt in one round trip. `nudge` is rendered by the app
 * rather than the extension so there is no second copy of the wording to drift
 * — the extension appends a string it never authors.
 */
export interface GetSessionBriefResult {
	/** Whether the calling session is currently planning. */
	planMode: boolean;
	naming: SessionBriefNaming;
	/** Ready-to-append upkeep block, or null when nothing is outstanding. */
	nudge: string | null;
}

/** Args for `focusTab`: bring a session tab (chat/terminal/diff/…) to the foreground. */
export interface FocusTabArgs {
	chatTabId: string;
}

/** Args for `focusDockTab`: focus a dock terminal by id, or the setup/run script tab by kind. */
export interface FocusDockTabArgs {
	terminalId?: string;
	kind?: 'setup' | 'run';
}

/** Review-panel tabs an agent can focus. */
export type FocusPanelName = 'files' | 'changes' | 'checks';

/** Args for `focusPanel`: focus the Files, Changes, or Checks review panel. */
export interface FocusPanelArgs {
	panel: FocusPanelName;
}

/** Args for `setWorkspaceStatus`: move the caller's own workspace on the kanban board. */
export interface SetWorkspaceStatusArgs {
	status: WorkspaceBoardStatusValue;
}

/**
 * Main → renderer request to set a workspace's kanban board status. The renderer
 * applies it to the shared board-status atom (and its localStorage) regardless of
 * which workspace view is mounted, since the board is global.
 */
export interface BoardStatusBroadcast {
	workspaceId: string;
	status: WorkspaceBoardStatusValue;
}

/**
 * What a focus request targets, as broadcast to the renderer. `dock` is a
 * `DockTabId` string (`'setup'`, `'run'`, or `terminal:<id>`).
 */
export type FocusTarget =
	| { kind: 'tab'; chatTabId: string }
	| { kind: 'dock'; dock: string }
	| { kind: 'panel'; panel: FocusPanelName };

/**
 * Main → renderer focus request. The renderer applies it only for the window
 * showing `workspaceId`, so a focus is naturally scoped to its workspace.
 */
export interface FocusViewBroadcast {
	workspaceId: string;
	target: FocusTarget;
}

/**
 * Main → renderer signal that an agent mutated the workspace's tab set (opened
 * or closed a tab). The renderer invalidates its cached tab list for the given
 * workspace so an agent-created tab surfaces immediately instead of waiting for
 * an unrelated refetch.
 */
export interface TabsChangedBroadcast {
	workspaceId: string;
}

/** Machine-readable failure codes returned to the calling agent. */
export type AgentControlErrorCode =
	| 'invalid-args'
	| 'denied-permission'
	| 'denied-scope'
	| 'denied-depth'
	| 'denied-quota'
	| 'denied-rate'
	| 'denied-deadlock'
	| 'not-found'
	| 'timeout'
	| 'internal';

/** Successful op result carrying the op-specific payload. */
export interface AgentControlSuccess<T> {
	ok: true;
	data: T;
}

/** Failed op result carrying a stable code and a human-readable reason. */
export interface AgentControlFailure {
	ok: false;
	code: AgentControlErrorCode;
	error: string;
}

/** Uniform envelope every control op resolves to. */
export type AgentControlResult<T> =
	| AgentControlSuccess<T>
	| AgentControlFailure;

/** Lightweight tab descriptor returned by `listTabs`. */
export interface AgentControlTabInfo {
	chatTabId: string;
	kind: string;
	title: string;
	workspaceId: string;
	piSessionId: string | null;
}

/** Lightweight terminal descriptor returned by `listTerminals`. */
export interface AgentControlTerminalInfo {
	terminalId: string;
	kind: string;
	status: string;
	workspaceId: string;
}

/** Lightweight workspace descriptor returned by `listWorkspaces`. */
export interface AgentControlWorkspaceInfo {
	workspaceId: string;
	name: string;
	cwd: string;
	/** Current kanban board status (defaults to `backlog` when unreported). */
	boardStatus: WorkspaceBoardStatusValue;
}

/** Conversation status returned by `getConversationStatus`. */
export interface AgentControlConversationStatus {
	piSessionId: string;
	status: string;
	runtimeOpen: boolean;
	/**
	 * Whether a final assistant message is persisted and retrievable via
	 * `getLastMessage`. Stays true after the session closes or the app restarts,
	 * so an orchestrator can recover a finished child's report instead of
	 * re-spawning it.
	 */
	hasFinalMessage: boolean;
}

/**
 * The report returned by `getLastMessage`: every assistant message of the
 * conversation's newest answered turn, joined in the order it was written, so a
 * child that files its findings and then signs off with a hand-off line still
 * hands back the findings. `message` is null when the session is unknown or has
 * produced no assistant text yet; the wrapping object keeps that null
 * distinguishable from the empty success envelope a bare null would otherwise
 * render as.
 */
export interface GetLastMessageResult {
	message: string | null;
}

/** One available Pi model, as returned by `listModels`. */
export interface AgentControlModelInfo {
	id: string;
	provider: string;
	displayName: string;
}

/** Available Pi models plus the default, returned by `listModels`. */
export interface AgentControlModelList {
	defaultModelId: string | null;
	models: readonly AgentControlModelInfo[];
}
