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
 */
const WRITE_OPS: ReadonlySet<AgentControlOp> = new Set([
	'spawnChatTab',
	'startConversation',
	'sendFollowUp',
	'setName',
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
 * Args for `waitForAgents`: block the caller's turn until delegated Pi children
 * finish or need a decision. `targets` defaults to every live child of the
 * caller; `mode` defaults to `'first'`; `timeoutMs` is clamped to the app's wait
 * timeout.
 */
export interface WaitForAgentsArgs {
	targets?: string[];
	mode?: WaitMode;
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
}

/** Result of `waitForAgents`: the children that settled, and whether it timed out. */
export interface WaitForAgentsResult {
	completed: readonly WaitedAgent[];
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
