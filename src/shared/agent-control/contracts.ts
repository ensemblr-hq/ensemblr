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
import type { AgentProviderId } from '../agent-provider.ts';
import { ARCHITECTURE_DIAGRAM_LIMITS } from '../architecture-diagram/schema.ts';
import type { ReviewCommentWire } from '../ipc/contracts/review-comments.ts';
import type {
	WorkspaceGitChangeSummaryWire,
	WorkspaceGitFileWire,
} from '../ipc/contracts/workspace-git.ts';
import { MAX_AGENT_PAYLOAD_CHARS } from './workspace-diff.ts';

/** Every control operation an agent may request, read and write alike. */
export const AGENT_CONTROL_OPS = [
	'spawnChatTab',
	'startConversation',
	'sendFollowUp',
	'setName',
	'setBranchName',
	'setSummary',
	'getArchitectureDiagram',
	'updateArchitectureDiagram',
	'closeTab',
	'launchHarness',
	'startTerminal',
	'stopTerminal',
	'writeTerminal',
	'openTab',
	'focusTab',
	'focusDockTab',
	'focusPanel',
	'focusWorkspace',
	'createWorkspace',
	'recallMemory',
	'setWorkspaceStatus',
	'getWorkspaceStatus',
	'getWorkspaceDiff',
	'getDiffComments',
	'addDiffComments',
	'resolveDiffComments',
	'linearListIssues',
	'linearGetIssue',
	'linearGetMetadata',
	'linearCreateComment',
	'linearCreateIssue',
	'linearUpdateIssue',
	'listProjects',
	'listWorkspaces',
	'listTabs',
	'listTerminals',
	'getConversationStatus',
	'getLastMessage',
	'readConversation',
	'readTerminalOutput',
	'listModels',
	'listRunScripts',
	'waitForAgents',
	'notifyOrchestrator',
	'askUserQuestion',
	'getSessionBrief',
	'checkPlanModeTool',
	'exitPlanMode',
] as const;

/**
 * One project — a git repository Ensemblr has opened — as `listProjects`
 * reports it. `path` is the project's own clone rather than a worktree, so it is
 * readable but never a place to put an agent: work happens in a workspace cut
 * from it.
 */
export interface AgentControlProjectInfo {
	defaultBranch: string | null;
	name: string;
	path: string;
	projectId: string;
	slug: string;
	/** How many live workspaces are cut from the project right now. */
	workspaceCount: number;
}

/** One workspace row, as `ensemblr_create_workspace` reports what it made. */
export interface CreatedWorkspaceResult {
	branchName: string | null;
	name: string;
	path: string;
	projectId: string;
	workspaceId: string;
}

/** One memory the Concierge recalled, with the snippet the match came from. */
export interface RecalledMemory {
	kind: string;
	/** Path relative to the Concierge home, so the agent can open the file itself. */
	relativePath: string;
	slug: string;
	snippet: string;
	summary: string;
	title: string;
}

/** What a memory search returns, plus what the payload budget cut. */
export interface RecallMemoryResult {
	memories: readonly RecalledMemory[];
	/** Slugs a match produced but the payload budget dropped. */
	omittedSlugs: readonly string[];
}

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
	'updateArchitectureDiagram',
	'closeTab',
	'launchHarness',
	'startTerminal',
	'stopTerminal',
	'writeTerminal',
	'openTab',
	'focusTab',
	'focusDockTab',
	'focusPanel',
	'focusWorkspace',
	'createWorkspace',
	'setWorkspaceStatus',
	'addDiffComments',
	'resolveDiffComments',
	'linearCreateComment',
	'linearCreateIssue',
	'linearUpdateIssue',
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
	'createWorkspace',
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

/** Thinking-level tokens an agent runtime accepts, kept loose as a string on the wire. */
export type AgentControlThinkingLevel = string;

/** Args for `spawnChatTab`: open an empty chat tab in the caller's workspace. */
export interface SpawnChatTabArgs {
	title?: string;
}

/** Args for `startConversation`: open (or reuse) a chat tab and submit a first prompt. */
export interface StartConversationArgs {
	chatTabId?: string;
	prompt: string;
	/**
	 * Workspace to open the conversation in. Concierge-only, and required of it —
	 * delegating into a workspace is the Concierge's only way to change anything,
	 * and it has none of its own to default to.
	 */
	workspaceId?: string;
	model?: string;
	thinkingLevel?: AgentControlThinkingLevel;
	/** Short, descriptive name for the new conversation's tab (Pi `/name`). */
	title?: string;
	/** Block until the child conversation completes, subject to the wait timeout. */
	wait?: boolean;
}

/** Args for `setName`: set the display title of the caller's own conversation tab. */
export interface SetNameArgs {
	title: string;
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
	/**
	 * Set only when the user asked for a different branch name in so many words.
	 * It lifts the once-per-branch gate, which is otherwise the difference between
	 * an agent naming unprompted work and one carrying out an instruction.
	 */
	userRequested?: boolean;
}

/**
 * Result of `setBranchName`. Naming is one-shot unless the user asks again — a
 * branch the user (or an earlier agent) already named reports `applied: false`
 * rather than failing, so the agent stops retrying instead of treating it as a
 * transient fault.
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
 *
 * Both are enforced by truncation rather than rejection. A summary is the most
 * token-heavy payload on the surface and the only one whose whole point is to
 * survive the turn: refusing an over-long one costs a multi-kilobyte re-emit and
 * risks the record being dropped rather than shortened.
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
	/**
	 * Every field cut to fit {@link SET_SUMMARY_LIMITS}, in submission order.
	 * Absent rather than empty on a submission that fit, so a caller can tell a
	 * stored record from a shortened one without parsing the message. Both fields
	 * can be over at once, and a caller that fixes only the one it was told about
	 * would resubmit and be cut again.
	 */
	truncated?: readonly SetSummaryTruncation[];
}

/** What `setSummary` cut from one field to fit its limit. */
export interface SetSummaryTruncation {
	field: 'summary' | 'title';
	limit: number;
	submittedLength: number;
}

/**
 * Upper bound on an architecture-diagram submission, re-exported from the IR
 * schema that also enforces it.
 *
 * One number rather than two: the op refuses an oversized submission so the
 * agent is told which bound it crossed, and the schema refuses an oversized
 * *document* so a hand-edited or cloned `.ensemblr/architecture.json` cannot
 * reach the compiler by a path the op never sees.
 */
export { ARCHITECTURE_DIAGRAM_LIMITS };

/**
 * Result of `getArchitectureDiagram`.
 *
 * `diagram` is null for a workspace nobody has drawn yet, which is an ordinary
 * answer rather than a failure: nothing derives a diagram, so the recovery is
 * for the caller to author one and submit it.
 */
export interface GetArchitectureDiagramResult {
	componentCount: number;
	connectionCount: number;
	/** The full architecture IR, ready to edit and submit back, or null. */
	diagram: unknown;
	message: string;
}

/**
 * Args for `updateArchitectureDiagram`: replace the workspace's stored diagram
 * with a new one. The whole document is submitted rather than a patch, because
 * a partial edit against a document another agent may have already replaced is
 * a merge nobody can adjudicate.
 */
export interface UpdateArchitectureDiagramArgs {
	/**
	 * The full architecture IR. Normally an object; a JSON string is decoded
	 * rather than refused, since that encoding is a bridge's doing rather than
	 * the caller's.
	 */
	diagram: unknown;
}

/** Result of `updateArchitectureDiagram`. */
export interface UpdateArchitectureDiagramResult {
	componentCount: number;
	connectionCount: number;
	message: string;
}

/**
 * Why an architecture op could not be served, as one word the dispatcher maps
 * onto a failure code. Four rather than one because the recoveries have nothing
 * in common: `invalid` is the caller's own document and is fixed by resubmitting
 * a corrected one, `unreadable` is a tracked file only the user can repair,
 * `store-failed` is a write that did not land, and `unavailable` is a read that
 * could not run at all. Collapsing them is what sends an agent to rewrite a
 * document that was already valid.
 */
export type ArchitectureFailureReason =
	| 'invalid'
	| 'store-failed'
	| 'unavailable'
	| 'unreadable';

/** A refused architecture op: the reason word and the message the agent reads. */
export interface ArchitectureFailure {
	message: string;
	ok: false;
	reason: ArchitectureFailureReason;
}

/**
 * What `readDiagram` answers with. The payload is wrapped rather than widened
 * with an `ok` field of its own, so a success hands the agent exactly
 * {@link GetArchitectureDiagramResult} and nothing about the port's plumbing.
 */
export type ReadArchitectureDiagramOutcome =
	| ArchitectureFailure
	| { ok: true; result: GetArchitectureDiagramResult };

/** What `updateDiagram` answers with, shaped like {@link ReadArchitectureDiagramOutcome}. */
export type UpdateArchitectureDiagramOutcome =
	| ArchitectureFailure
	| { ok: true; result: UpdateArchitectureDiagramResult };

/** Args for `sendFollowUp`: submit a follow-up prompt into an existing conversation. */
export interface SendFollowUpArgs {
	agentSessionId: string;
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
	/**
	 * Which named run script to start (`kind: 'run'` only), as listed by
	 * `listRunScripts`. Omitted starts the repository's default script.
	 */
	scriptName?: string;
	/**
	 * Replace a script of this kind that is already running (`kind: 'setup'` and
	 * `'run'` only). Without it a second start is refused with `conflict`, which
	 * is the affordance that refusal points the caller at.
	 */
	restart?: boolean;
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

/** Args for `getConversationStatus` / `getLastMessage`: target an agent session. */
export interface ConversationRef {
	agentSessionId: string;
}

/**
 * Upper bounds on a `readConversation` page. The field cap is what stops one
 * pathological tool result — a whole file read, a megabyte of test output — from
 * being the only thing a page can carry, and the page cap is the same ceiling
 * every other agent payload answers to.
 */
export const READ_CONVERSATION_LIMITS = {
	maxFieldChars: 2_000,
	maxPageChars: MAX_AGENT_PAYLOAD_CHARS,
} as const;

/**
 * Args for `readConversation`: page through a conversation's persisted
 * transcript. `stat`, `ordinal`, and `fromOrdinal` are alternatives rather than
 * a combination, and are honoured in that order.
 */
export interface ReadConversationArgs {
	agentSessionId: string;
	/** Counts and ordinal range only, with no entries. */
	stat?: boolean;
	/** Inclusive lower bound on entry ordinal — the cursor a previous page returned. */
	fromOrdinal?: number;
	/** Read one entry on its own, with its field cap lifted to the page budget. */
	ordinal?: number;
}

/**
 * One projected step of a conversation, ordered by the event ordinal it came
 * from. A `tool` entry merges a call with its result and carries the call's
 * ordinal, so a result persisted much later still reads in sequence.
 */
export type ConversationTranscriptEntry =
	| { kind: 'prompt'; ordinal: number; text: string }
	| { kind: 'message'; ordinal: number; text: string }
	| {
			kind: 'tool';
			ordinal: number;
			name: string;
			input: string;
			output: string;
			isError: boolean;
	  }
	| { kind: 'error'; ordinal: number; text: string };

/**
 * A page of a conversation's transcript. The counts and ordinal bounds describe
 * the whole branch rather than the page, which is what makes a `stat` probe
 * worth calling before a read: it says how much there is to page through.
 */
export interface ReadConversationResult {
	agentSessionId: string;
	/** Entries on the whole branch, after checkpoint-hidden events are excluded. */
	entryCount: number;
	/** User prompts on the branch — one per turn. */
	turnCount: number;
	firstOrdinal: number | null;
	lastOrdinal: number | null;
	/** This page, ascending by ordinal. Empty for a `stat` probe. */
	entries: readonly ConversationTranscriptEntry[];
	/** Cursor for the next page, or null when this page reached the end. */
	nextOrdinal: number | null;
}

/** Args for `readTerminalOutput`: read a terminal's current scrollback. */
export interface ReadTerminalOutputArgs {
	terminalId?: string;
	/** Read the workspace's setup or run script terminal without knowing its id. */
	kind?: 'setup' | 'run';
	/**
	 * Keep the raw PTY bytes — escape sequences, cursor moves, repaint blanks —
	 * instead of the readable text the read returns by default.
	 */
	ansi?: boolean;
}

/** A terminal's scrollback, with the terminal a logical selector resolved to. */
export interface ReadTerminalOutputResult {
	terminalId: string;
	/** Scrollback text, or null when the terminal holds none. */
	output: string | null;
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
 * Args for `waitForAgents`: block the caller's turn until delegated children
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
	agentSessionId: string;
	status: string;
	lastMessage: string | null;
	/** The child's pending signal when it woke the wait, else null. */
	signal: OrchestratorSignal | null;
	/** Whether `lastMessage` was shortened and the rest is still fetchable. */
	reportTruncated: boolean;
}

/** A target that had not settled when `waitForAgents` returned. */
export interface PendingAgent {
	agentSessionId: string;
	status: string;
}

/**
 * Result of `waitForAgents`: the children that settled, the ones still running,
 * and whether it timed out. `pending` spares the caller a status poll per child
 * when the wait returns before every target is done — on `mode: "first"`, on a
 * signal, or on a timeout. `note` carries the same instruction as prose, because
 * an orchestrator reads a bare `timedOut: true` as a fault to report rather than
 * a lap of the wait loop.
 */
export interface WaitForAgentsResult {
	completed: readonly WaitedAgent[];
	pending: readonly PendingAgent[];
	timedOut: boolean;
	note?: string;
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
 * reachable by a single number key. `maxHeaderLength` and
 * `maxDescriptionLength` are trim points rather than rejections — losing a
 * questionnaire over either costs the agent a round trip and buys nothing.
 *
 * The description is the one field the dialog renders in full rather than on a
 * single line, because an option's description is where an agent puts the
 * recommendation the choice turns on. It is capped generously — several
 * sentences — so the card holds a real argument, and the row list scrolls once
 * the options outgrow it.
 */
export const ASK_USER_QUESTION_LIMITS = {
	maxQuestions: 4,
	maxOptions: 6,
	minOptions: 2,
	maxHeaderLength: 64,
	maxLabelLength: 80,
	maxDescriptionLength: 400,
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
 * renderer shows it only in the chat tab bound to `agentSessionId`, so a question
 * is answered in the conversation that asked it.
 */
export interface AskUserQuestionBroadcast {
	requestId: string;
	workspaceId: string;
	agentSessionId: string;
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
 * shows it only in the chat tab bound to `agentSessionId`, so a plan is reviewed
 * in the conversation that wrote it. Carries no plan body: the app posts the
 * plan into that tab's timeline as a separate assistant message, so this
 * broadcast only needs the title and saved path — shipping the plan again here
 * would duplicate it on screen.
 */
export interface ExitPlanModeBroadcast {
	requestId: string;
	workspaceId: string;
	agentSessionId: string;
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
	agentSessionId: string;
	planMode: boolean;
}

/** Args for `checkPlanModeTool`: ask whether a tool call is allowed while planning. */
export interface CheckPlanModeToolArgs {
	tool: string;
	/** The command a `bash` call would run; absent for other tools. */
	command?: string;
	/**
	 * The path a `write`/`edit` call would touch. Plan Mode ignores it — it blocks
	 * every write whatever the target — but the Concierge policy is a containment
	 * rule, so the path is the whole question there.
	 */
	path?: string;
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
		/** The git branch still carries the name it was cut with. */
		eligible: boolean;
		/** The workspace's current git branch, or null when it has none. */
		current: string | null;
		/**
		 * Whether naming the branch also retitles the workspace. False once the
		 * user has titled it, at which point only the branch moves.
		 */
		namesWorkspace: boolean;
		/**
		 * Whether the name on the workspace is the app's own guess, derived from
		 * the first prompt so a planning workspace is never blank on the board.
		 * The agent is asked to improve it rather than to supply a first name.
		 */
		provisional: boolean;
	};
	/**
	 * Whether the workspace's stored architecture diagram has fallen behind the
	 * code it draws. Absent from a workspace nobody has drawn: there is nothing
	 * to keep current there, and the drawing is the user's to ask for.
	 */
	diagram: {
		/** Labels of the diagram's components the change set landed in. */
		components: readonly string[];
		/** A component's `sources` cover a file changed since the diagram was drawn. */
		stale: boolean;
	};
	/** Turns have landed since the recorded summary was written. */
	summaryStale: boolean;
}

/**
 * Result of `getSessionBrief`: everything the Pi extension needs to assemble
 * this turn's system prompt in one round trip. `nudge`, `planRefinement`, and
 * `languageDirective` are all rendered by the app rather than the extension so
 * there is no second copy of the wording to drift — the extension appends
 * strings it never authors.
 */
export interface GetSessionBriefResult {
	/** Whether the calling session is currently planning. */
	planMode: boolean;
	naming: SessionBriefNaming;
	/** Ready-to-append upkeep block, or null when nothing is outstanding. */
	nudge: string | null;
	/**
	 * Ready-to-append directive telling a planning session to close this turn by
	 * submitting the revised plan, or null when no plan of its own is waiting on
	 * the user.
	 */
	planRefinement: string | null;
	/**
	 * Ready-to-append instruction to write user-facing prose in the app's
	 * language, or null when the app is in English and the model's own
	 * language-mirroring should stand.
	 */
	languageDirective: string | null;
	/**
	 * Ready-to-append instruction to keep the workspace's linked Linear issue
	 * current, cut to what this caller's role and mode may actually do to a
	 * tracker, or null when the workspace was not created from a Linear issue.
	 */
	issueDirective: string | null;
	/**
	 * The role playbook to use in place of the one the extension holds, or null
	 * when the extension's own copy is the right one. The Concierge is the case
	 * that needs it: its playbook has no counterpart in the extension, and a
	 * Concierge served the orchestrator copy is told to do work in a workspace it
	 * has none of and to name a chat tab it does not own.
	 */
	rolePlaybook: string | null;
}

/** Args for `focusTab`: bring a session tab (chat/terminal/diff/…) to the foreground. */
export interface FocusTabArgs {
	chatTabId: string;
}

/** Args for `focusDockTab`: focus a dock terminal by id, or the setup/run script tab by kind. */
export interface FocusDockTabArgs {
	terminalId?: string;
	kind?: 'setup' | 'run';
	/** Concierge-only; every other caller may name only its own workspace. */
	workspaceId?: string;
}

/** Review-panel tabs an agent can focus. */
export type FocusPanelName = 'files' | 'changes' | 'checks';

/** Args for `focusPanel`: focus the Files, Changes, or Checks review panel. */
export interface FocusPanelArgs {
	panel: FocusPanelName;
	/** Concierge-only; every other caller may name only its own workspace. */
	workspaceId?: string;
}

/** Args for `focusWorkspace`: move the app to a workspace. Concierge-only. */
export interface FocusWorkspaceArgs {
	workspaceId: string;
}

/** Args for `createWorkspace`: cut a new workspace off a project. Concierge-only. */
export interface CreateWorkspaceArgs {
	baseBranch?: string;
	/**
	 * What the workspace is for, which becomes its git branch: the create service
	 * slugs it and joins it to the repository's branch prefix. Required, and
	 * validated against a placeholder list, because omitting it used to yield a
	 * worktree called `workspace` on a branch called `<prefix>/workspace`.
	 */
	name: string;
	projectId: string;
}

/** Args for `recallMemory`: search the Concierge's own memory index. */
export interface RecallMemoryArgs {
	limit?: number;
	query: string;
}

/** Args for `getWorkspaceStatus`: read a workspace's kanban status. */
export interface GetWorkspaceStatusArgs {
	/** Concierge-only; every other caller reads its own. */
	workspaceId?: string;
}

/** Args for `setWorkspaceStatus`: move the caller's own workspace on the kanban board. */
export interface SetWorkspaceStatusArgs {
	status: WorkspaceBoardStatusValue;
	/** Concierge-only; every other caller moves its own workspace. */
	workspaceId?: string;
}

/**
 * Args for `getWorkspaceDiff`: read the caller's own workspace diff, scoped the
 * way the Changes panel scopes it — every change on this branch, committed and
 * uncommitted alike. `stat` is the cheap probe that reports which files changed
 * and how large the diff is; `filePath` reads one file's patch, which is also
 * how a file dropped from a budgeted full read is recovered. The two are
 * alternatives rather than a filter pair, and sending both is rejected: a single
 * file has no stat, and silent precedence would leave the caller unsure which
 * read it got.
 */
export interface GetWorkspaceDiffArgs {
	/** Workspace-relative path of a single file to read. */
	filePath?: string;
	/** Return the changed-file rows and totals only, with no patch text. */
	stat?: boolean;
	/** Concierge-only; every other caller reads its own workspace. */
	workspaceId?: string;
}

/**
 * Result of `getWorkspaceDiff`. Which fields are populated follows the request:
 * `stat` returns `files` + `summary` and no `diff`; a single `filePath` returns
 * `diff` alone; the full read returns all of them. `truncated` covers every cut
 * the payload can take — whole files dropped for the budget, one file's patch
 * cut at a hunk boundary to fit it, and a patch git itself cut at its output cap.
 */
export interface GetWorkspaceDiffResult {
	/** Ref the branch diff forks from, or null when it fell back to the working tree. */
	baseRef: string | null;
	files?: readonly WorkspaceGitFileWire[];
	summary?: WorkspaceGitChangeSummaryWire;
	diff?: string;
	truncated: boolean;
	/** Files left out of `diff`; each is re-requestable on its own with `filePath`. */
	omittedFiles: readonly string[];
}

/**
 * Args for `getDiffComments`: read the review comments on the caller's own
 * workspace, optionally narrowed to one file.
 */
export interface GetDiffCommentsArgs {
	filePath?: string;
	/** Concierge-only; every other caller reads its own workspace. */
	workspaceId?: string;
}

/**
 * Result of `getDiffComments`. Ensemblr-local comments only — the ones the user
 * left in the Changes panel and the ones agents filed there. Comments synced
 * from a GitHub pull request live in a separate snapshot and are deliberately
 * absent, because nothing in this surface could reply to or resolve one.
 */
export interface GetDiffCommentsResult {
	comments: readonly ReviewCommentWire[];
}

/**
 * Upper bounds on a batch of review-comment work — both the notes
 * `addDiffComments` files and the ids `resolveDiffComments` closes. The body cap
 * matches {@link SET_SUMMARY_LIMITS}: a review note that grows past it has
 * stopped being a comment on a line. The batch cap is a runaway guard — fifty
 * notes is already more than a human reviewer leaves on one pass, and a resolve
 * set cannot outgrow what the add path could have created.
 */
export const DIFF_COMMENT_LIMITS = {
	maxComments: 50,
	maxBodyLength: 4_000,
} as const;

/** One review comment an agent files against a line of the workspace diff. */
export interface AgentDiffComment {
	/** Workspace-relative path of the file being commented on. */
	filePath: string;
	/** 1-based line in the file's new side; null for a file-level comment. */
	lineNumber?: number | null;
	body: string;
}

/** Args for `addDiffComments`: file review comments on the caller's own workspace. */
export interface AddDiffCommentsArgs {
	comments: readonly AgentDiffComment[];
	/** Concierge-only; every other caller comments on its own workspace. */
	workspaceId?: string;
}

/**
 * Result of `addDiffComments`. Ids rather than whole rows: the agent wrote the
 * bodies, so echoing them back spends its context on text it already holds.
 */
export interface AddDiffCommentsResult {
	added: number;
	commentIds: readonly string[];
	message: string;
}

/**
 * Args for `resolveDiffComments`: close review comments on the caller's own
 * workspace, by the ids `getDiffComments` and `addDiffComments` hand back.
 *
 * Resolve-only, with no status argument: reopening reverses a judgement the user
 * made in the Changes panel with nothing in the UI to announce it, and archiving
 * drops a comment out of every listing, which is a delete by another name. An
 * agent that disagrees with a finding files a fresh comment carrying the reason.
 */
export interface ResolveDiffCommentsArgs {
	commentIds: readonly string[];
	/** Concierge-only; every other caller resolves on its own workspace. */
	workspaceId?: string;
}

/**
 * Result of `resolveDiffComments`. `alreadyResolved` is split out so a re-run
 * reads as a no-op rather than a failure; `notFound` deliberately merges "no such
 * id", "belongs to another workspace", and "archived", because telling them apart
 * would make the op a cross-workspace id-existence oracle.
 */
export interface ResolveDiffCommentsResult {
	resolved: number;
	resolvedIds: readonly string[];
	alreadyResolved: readonly string[];
	notFound: readonly string[];
	message: string;
}

/**
 * Bounds on the Linear ops, split by direction. The submission caps are runaway
 * guards on what an agent writes to the tracker; the returned caps are what stops
 * one issue's description or one long comment thread from spending the payload
 * budget the whole result has to fit inside. Linear itself enforces a 255-char
 * issue title, so that one is echoed here rather than invented.
 */
export const LINEAR_AGENT_LIMITS = {
	maxCommentLength: 8_000,
	maxDescriptionLength: 32_000,
	/** Labels a filed issue may carry; a runaway guard, not a Linear limit. */
	maxLabelIds: 10,
	maxTitleLength: 255,
	/** Comments returned alongside one issue, newest last. */
	maxReturnedComments: 40,
	maxReturnedCommentChars: 1_500,
	maxReturnedDescriptionChars: 4_000,
} as const;

/**
 * Workflow-state categories an agent may not move an issue into. These are
 * Linear's own `type` values: `completed` covers every Done column and `canceled`
 * every Canceled one. Both close a ticket, so refusing one and allowing the other
 * would be the same failure under a different label — an agent takes work as far
 * as In Review and a human decides whether it is finished.
 */
export const LINEAR_TERMINAL_STATE_TYPES = ['canceled', 'completed'] as const;

/**
 * Workflow-state categories a newly filed issue may open in. Linear's own `type`
 * values again: `triage` for a team that runs one, `backlog` and `unstarted` for
 * a team that does not. `started` is absent for the same reason the terminal
 * types are — a ticket an agent filed and nobody has read yet is not in
 * progress, and a board that says otherwise is the tracker lying about who is
 * working on what.
 */
export const LINEAR_INITIAL_STATE_TYPES = [
	'backlog',
	'triage',
	'unstarted',
] as const;

/**
 * How a Linear op ended, in the vocabulary an agent acts on. Linear is often not
 * connected at all, so every op answers with one of these rather than throwing:
 * `not-connected` means tell the user to connect Linear in Settings and stop
 * asking, `not-found` means the id was wrong, `refused` means the app declined a
 * change it will never make, and `failed` covers everything Linear's API reported
 * — a network fault, a rate limit, a permission error.
 */
export type LinearAgentStatus =
	| 'ok'
	| 'not-connected'
	| 'not-found'
	| 'refused'
	| 'failed';

/**
 * One Linear issue as an agent reads it: flat, and named wherever a name exists,
 * because a model acts on `In Review` far more reliably than on the state's uuid.
 * The ids that survive are the ones an update takes back.
 */
export interface AgentLinearIssue {
	id: string;
	/**
	 * Linear account the issue belongs to. Several can be connected, and `ENG-1`
	 * is unique inside an organization but not between two, so an op acting on a
	 * merged list carries this back rather than the identifier alone.
	 */
	accountId: string;
	/** Owning account's Linear organization, for a human-readable disambiguator. */
	organization: string | null;
	/** Human key, e.g. `ENG-106` — what a branch, PR, or commit cites. */
	identifier: string;
	title: string;
	url: string;
	state: string | null;
	stateId: string | null;
	/** Linear's workflow category behind `state`, e.g. `started`, `completed`. */
	stateType: string | null;
	assignee: string | null;
	/**
	 * Assignee's Linear user id, so an agent can tell whether the issue is already
	 * assigned to the account's own `viewer` without matching display names.
	 */
	assigneeId: string | null;
	priority: number | null;
	team: string | null;
	project: string | null;
	updatedAt: string | null;
}

/** One issue read on its own, with the fields a list view deliberately omits. */
export interface AgentLinearIssueDetail extends AgentLinearIssue {
	/** Truncated to {@link LINEAR_AGENT_LIMITS.maxReturnedDescriptionChars}. */
	description: string | null;
	labels: readonly string[];
	/** Cycle the issue is scheduled in, or null when the team runs none. */
	cycle: string | null;
}

/** One comment on a Linear issue, truncated to the returned-body cap. */
export interface AgentLinearComment {
	author: string | null;
	body: string;
	createdAt: string | null;
}

/**
 * One cached Linear metadata row. A single shape across teams, projects, states,
 * labels, and users rather than five: an agent reads all of them for the same
 * reason — to turn a name it knows into the id an update takes.
 */
export interface AgentLinearResource {
	id: string;
	/** Linear account this row belongs to; pass it back when creating or updating. */
	accountId: string;
	name: string;
	/** Short team key (`THE`) for a team; null for every other kind. */
	key: string | null;
	/** Workflow category for a state (`started`, `completed`, …); null otherwise. */
	type: string | null;
	/** Owning team for the states and labels scoped to one; null otherwise. */
	teamId: string | null;
}

/**
 * What every Linear op reports about how it went. `message` is the prose an agent
 * reads on anything other than `ok`, and on a truncated read it names what was cut
 * — a payload silently shortened reads as a complete answer.
 */
export interface LinearAgentOutcome {
	status: LinearAgentStatus;
	message: string;
	/**
	 * The connected accounts, listed on a failed op when more than one is
	 * connected — an ambiguity refusal is the case that needs them, but any
	 * failure an agent might fix by naming an account is only actionable if it can
	 * see which accounts exist. Omitted on success, and omitted whenever a single
	 * account is connected, so the common answer spends no budget repeating a
	 * choice that was never in question.
	 */
	accounts?: readonly LinearAccountRef[];
}

/** One connected Linear account, as named back to an agent that must pick one. */
export interface LinearAccountRef {
	accountId: string;
	organization: string | null;
	user: string | null;
	/**
	 * Linear user id the account is authorized as. Carried because it is the one
	 * answer an agent cannot look up: `assigneeId` takes an id, and matching the
	 * `user` display name against the users table is a guess two people with the
	 * same first name break.
	 */
	userId: string;
}

/**
 * The Linear user one in-scope account is connected as, as `linearGetMetadata`
 * reports it. Named `viewer` after Linear's own term for the authenticated user:
 * an agent has no Linear identity of its own, so "assign it to me" resolves to
 * the human whose account the app is acting through.
 */
export interface AgentLinearViewer {
	accountId: string;
	userId: string;
	name: string | null;
}

/**
 * The remote issue a workspace was created from, as the app reads it back off the
 * workspace's own metadata. Local state rather than a Linear read: it costs one
 * SQLite lookup, which is what lets the linked-issue directive be rendered on
 * every turn. Nothing here is live — the state the issue is actually in comes
 * from `linearGetIssue`.
 */
export interface WorkspaceLinkedIssue {
	provider: 'github' | 'linear';
	/** Human key the branch, commits, and pull request cite, e.g. `ENG-106`. */
	identifier: string;
	title: string;
	url: string | null;
	/** Linear account owning the issue; null for GitHub and pre-ADR-0052 workspaces. */
	accountId: string | null;
}

/**
 * Args for `linearListIssues`: search the connected accounts' Linear issues.
 * Omitting `accountId` searches every connected account at once.
 */
export interface LinearListIssuesArgs {
	/** Narrow the search to one connected Linear account. */
	accountId?: string;
	/** Free-text match over identifier, title, and description. */
	query?: string;
	teamId?: string;
	/** Force a remote sync before reading, instead of serving a fresh cache. */
	refresh?: boolean;
}

/**
 * Result of `linearListIssues`. Descriptions are deliberately absent: a hundred
 * issues carrying theirs is what turns a list into a context spend, and
 * `linearGetIssue` is one call away for the one that matters.
 */
export interface LinearListIssuesResult extends LinearAgentOutcome {
	/** Whether the rows came from the local cache or a fresh Linear read. */
	source: 'cache' | 'remote' | null;
	issues: readonly AgentLinearIssue[];
	/** Rows dropped to fit the payload budget; narrow with `query` or `teamId`. */
	omittedIssues: number;
	truncated: boolean;
}

/** Args for `linearGetIssue`: read one issue with its comments. */
export interface LinearGetIssueArgs {
	/** Account owning the issue; needed only when an identifier is ambiguous. */
	accountId?: string;
	/** Issue uuid or its human identifier, e.g. `ENG-106`. */
	issueId: string;
	refresh?: boolean;
}

/** Result of `linearGetIssue`: the issue, its comments, and what was truncated. */
export interface LinearGetIssueResult extends LinearAgentOutcome {
	source: 'cache' | 'remote' | null;
	issue: AgentLinearIssueDetail | null;
	comments: readonly AgentLinearComment[];
	/** Comments dropped to fit the returned-comment cap. */
	omittedComments: number;
	truncated: boolean;
}

/** Args for `linearGetMetadata`: read the id↔name tables an update needs. */
export interface LinearGetMetadataArgs {
	/** Narrow the tables to one connected Linear account. */
	accountId?: string;
	refresh?: boolean;
}

/**
 * Result of `linearGetMetadata`. Cycles are left out: nothing on this surface
 * sets one, so returning them would spend budget on rows no op can use.
 */
export interface LinearGetMetadataResult extends LinearAgentOutcome {
	syncedAt: string | null;
	teams: readonly AgentLinearResource[];
	projects: readonly AgentLinearResource[];
	states: readonly AgentLinearResource[];
	labels: readonly AgentLinearResource[];
	users: readonly AgentLinearResource[];
	/**
	 * Who each in-scope account is connected as. Returned on every read rather than
	 * only on a failure the way `accounts` is: an agent taking a ticket on the
	 * user's behalf needs a `userId` to assign it to, and this op already exists to
	 * turn what an agent knows into the ids a write takes.
	 */
	viewer: readonly AgentLinearViewer[];
	/** Rows dropped to fit the payload budget, across every kind. */
	omittedResources: number;
	truncated: boolean;
}

/** Args for `linearCreateComment`: post a comment on a Linear issue. */
export interface LinearCreateCommentArgs {
	/** Account owning the issue; needed only when an identifier is ambiguous. */
	accountId?: string;
	issueId: string;
	commentBody: string;
}

/**
 * Result of `linearCreateComment`. The id alone rather than the whole comment:
 * the agent wrote the body, so echoing it back spends context on text it holds.
 */
export interface LinearCreateCommentResult extends LinearAgentOutcome {
	commentId: string | null;
}

/**
 * Args for `linearCreateIssue`. `teamId` is required and never inferred: several
 * Linear accounts can be connected and one account spans teams, so a guessed team
 * files the ticket on a board nobody who needs it is watching. Everything else is
 * optional, and an omitted `stateId` leaves the team's own default — Linear picks
 * triage or backlog, which is where an agent-filed ticket belongs.
 *
 * `labelIds`, `projectId`, and `assigneeId` are here where `linearUpdateIssue`
 * omits the first two: on a ticket that already exists they are planning
 * decisions a human is making, but on one the agent is filing they are the only
 * chance to put it in front of the right people at all.
 */
export interface LinearCreateIssueArgs {
	/** Account owning the team; refused rather than guessed when it disagrees. */
	accountId?: string;
	assigneeId?: string;
	description?: string;
	labelIds?: readonly string[];
	/** Linear's own scale: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
	priority?: number;
	projectId?: string;
	/** Workflow state to open in; a started, Done, or Canceled state is refused. */
	stateId?: string;
	teamId: string;
	title: string;
}

/**
 * Result of `linearCreateIssue`: the issue as Linear reports it after the write,
 * so the agent reads back the `identifier` a branch and a commit have to cite.
 */
export interface LinearCreateIssueResult extends LinearAgentOutcome {
	issue: AgentLinearIssue | null;
}

/**
 * Args for `linearUpdateIssue`. A deliberate subset of Linear's issue fields —
 * labels, project, cycle, and due date are planning decisions a human makes in
 * Linear, and every field exposed here is one more thing an agent can get wrong
 * on a ticket the whole team reads. At least one field beyond `issueId` is
 * required, since an update carrying nothing is a wasted round trip.
 */
export interface LinearUpdateIssueArgs {
	/** Account owning the issue; needed only when an identifier is ambiguous. */
	accountId?: string;
	issueId: string;
	/** Workflow state to move the issue into; a Done or Canceled state is refused. */
	stateId?: string;
	assigneeId?: string;
	/** Linear's own scale: 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
	priority?: number;
	title?: string;
	description?: string;
}

/** Result of `linearUpdateIssue`: the issue as Linear reports it after the write. */
export interface LinearUpdateIssueResult extends LinearAgentOutcome {
	issue: AgentLinearIssue | null;
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
	| { kind: 'panel'; panel: FocusPanelName }
	| { kind: 'workspace' };

/**
 * Main → renderer focus request. Every target but `workspace` is applied only by
 * the window already showing `workspaceId`, so a focus is naturally scoped to
 * its workspace; `workspace` is the one that has to cross, because its whole job
 * is to move the route to a workspace nobody is looking at. The Concierge is the
 * only caller that holds it.
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
	/**
	 * The chat a close really retired. The renderer drops its unread mark:
	 * nothing but reading a chat clears one, so a tab an agent closed before
	 * anyone looked at it would otherwise leave the sidebar dot and the jump
	 * control aimed at a chat that is gone.
	 *
	 * Absent unless a chat tab actually left the open set. A close of a terminal
	 * or file tab carries no mark to retire, and `closeTab` is a no-op for a tab
	 * that is already closed and for a workspace's last open chat — naming one of
	 * those would clear the mark of a tab still on screen.
	 */
	closedChat?: {
		agentSessionId: string | null;
		chatTabId: string;
	};
	workspaceId: string;
}

/**
 * Main → renderer signal that an agent filed review comments on a workspace. The
 * comment list is a cached query that only renderer-local mutations invalidate,
 * and the query client refetches neither on an interval nor on window focus — so
 * without this the Changes panel a user is watching while an agent reviews shows
 * nothing until it remounts.
 */
export interface ReviewCommentsChangedBroadcast {
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
	| 'conflict'
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
	agentSessionId: string | null;
}

/** Lightweight terminal descriptor returned by `listTerminals`. */
export interface AgentControlTerminalInfo {
	terminalId: string;
	kind: string;
	status: string;
	workspaceId: string;
	/** Named run script this terminal is running, or null for every other kind. */
	scriptName: string | null;
}

/** Lightweight workspace descriptor returned by `listWorkspaces`. */
export interface AgentControlWorkspaceInfo {
	workspaceId: string;
	name: string;
	cwd: string;
	/**
	 * Repository the workspace was cut from, and the id the Concierge writes a
	 * project reference with. `listProjects` carries the projects this listing
	 * cannot reach — the ones with no live workspace to name them.
	 */
	projectId: string;
	projectName: string;
	/** Current kanban board status (defaults to `backlog` when unreported). */
	boardStatus: WorkspaceBoardStatusValue;
}

/** Conversation status returned by `getConversationStatus`. */
export interface AgentControlConversationStatus {
	agentSessionId: string;
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

/**
 * One available agent model, as returned by `listModels`. `runtime` is the agent
 * runtime that would drive the chat and is the axis a spawn may not cross;
 * `vendor` is the inference vendor (`anthropic`, `openai`, `claude-code`) and is
 * descriptive only. They were both called "provider" once, which is how a spawn
 * check meant to keep a child inside its runtime ended up comparing vendors.
 */
export interface AgentControlModelInfo {
	displayName: string;
	id: string;
	runtime: AgentProviderId;
	vendor: string;
}

/**
 * Available agent models plus the default, returned by `listModels`. The list is
 * already cut to the calling orchestrator's own runtime, so every id in it is
 * one the caller may spawn a child on; `runtime` names which one, or is null for
 * a caller (a terminal harness) whose runtime the app cannot determine.
 */
export interface AgentControlModelList {
	defaultModelId: string | null;
	models: readonly AgentControlModelInfo[];
	runtime: AgentProviderId | null;
}

/** One run script the workspace's repository configures, as returned by `listRunScripts`. */
export interface AgentControlRunScriptInfo {
	name: string;
	command: string;
	/** True for the script `startTerminal` runs when no name is given. */
	isDefault: boolean;
}

/**
 * The run scripts a workspace can launch, returned by `listRunScripts`. Empty
 * when the repository configures none, in which case `startTerminal` with
 * `kind: 'run'` has nothing to start.
 */
export interface AgentControlRunScriptList {
	scripts: readonly AgentControlRunScriptInfo[];
}
