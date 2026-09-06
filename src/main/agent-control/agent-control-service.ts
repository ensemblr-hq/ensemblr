/**
 * The agent → app control service. One trusted, main-process entry point that
 * both bridges (the Pi extension and the harness MCP server) funnel into. Every
 * call is validated, its origin resolved from an injected token, permission- and
 * scope-checked, guardrailed, then delegated to an existing service via a port.
 */

import { afkModeControlOpDenial } from '../../shared/afk-mode.ts';
import type {
	AddDiffCommentsArgs,
	AgentControlConversationStatus,
	AgentControlErrorCode,
	AgentControlModelInfo,
	AgentControlOp,
	AgentControlResult,
	AgentControlRole,
	ArchitectureFailureReason,
	AskUserQuestionArgs,
	CheckPlanModeToolArgs,
	CloseTabArgs,
	ConciergeMessageSender,
	ControlAudience,
	ConversationRef,
	CreateWorkspaceArgs,
	ExitPlanModeArgs,
	FocusDockTabArgs,
	FocusPanelArgs,
	FocusTabArgs,
	FocusWorkspaceArgs,
	GetDiffCommentsArgs,
	GetLastMessageResult,
	GetSessionBriefResult,
	GetWorkspaceDiffArgs,
	GetWorkspaceStatusArgs,
	LaunchHarnessArgs,
	LinearCreateCommentArgs,
	LinearCreateIssueArgs,
	LinearGetIssueArgs,
	LinearGetMetadataArgs,
	LinearListIssuesArgs,
	LinearUpdateIssueArgs,
	ListTabsArgs,
	ListTerminalsArgs,
	MessageConciergeArgs,
	MessageConciergeResult,
	NotifyOrchestratorArgs,
	OpenTabArgs,
	OrchestratorSignal,
	PendingAgent,
	ReadConversationArgs,
	ReadTerminalOutputArgs,
	ReadTerminalOutputResult,
	RecallMemoryArgs,
	ResolveDiffCommentsArgs,
	SendFollowUpArgs,
	SetBranchNameArgs,
	SetNameArgs,
	SetNameResult,
	SetSummaryArgs,
	SetSummaryResult,
	SetSummaryTruncation,
	SetWorkspaceStatusArgs,
	SpawnChatTabArgs,
	StartConversationArgs,
	StartReviewArgs,
	StartReviewResult,
	StartTerminalArgs,
	StopTerminalArgs,
	UpdateArchitectureDiagramArgs,
	WaitedAgent,
	WaitForAgentsArgs,
	WaitForAgentsResult,
	WaitMode,
	WaitReportDetail,
	WriteTerminalArgs,
} from '../../shared/agent-control.ts';
import {
	briefReport,
	buildAfkDirective,
	buildAfkWorkflowDirective,
	buildCoAuthorDirective,
	buildConciergeMessage,
	buildLanguageDirective,
	buildLinkedIssueDirective,
	buildPeerBriefDirective,
	buildPlanModeDelegationDirective,
	buildReviewPeerDirective,
	buildSessionBriefNudge,
	CONCIERGE_AWARENESS,
	conciergeControlOpDenial,
	isWriteOp,
	PEER_ORCHESTRATOR_LIMITS,
	PLAN_REFINEMENT_DIRECTIVE,
	resolveAgentRole,
	retiredControlOpDenial,
	SET_SUMMARY_LIMITS,
	subAgentControlOpDenial,
	validateArgs,
} from '../../shared/agent-control.ts';
import { isFrontierAgentModel } from '../../shared/agent-model-tier.ts';
import {
	type AgentProviderId,
	getAgentProviderLabel,
} from '../../shared/agent-provider.ts';
import { classifyPermissionAction } from '../../shared/permissions.ts';
import {
	evaluateConciergeTool,
	evaluatePlanModeTool,
	planModeControlOpDenial,
	planModeFollowUpDenial,
} from '../../shared/plan-mode.ts';
import { BranchSlugRejected } from '../agent-runtime/naming/apply-branch-slug.ts';
import {
	DISPATCH_TIMEOUT_MS,
	withDispatchDeadline,
} from './dispatch-deadline.ts';
import type { Guardrails } from './guardrails.ts';
import type { OriginRegistry } from './origin-registry.ts';
import {
	type AgentControlOrigin,
	type AgentControlPorts,
	originHasChatTab,
	originRuntime,
	type ReviewLaunchBrief,
} from './ports.ts';
import { createReviewFocus } from './review-focus.ts';

/** A single inbound control command, as handed over by either bridge. */
export interface AgentControlCommand {
	op: AgentControlOp;
	/** Secret token minted at spawn; resolves to the trusted origin. */
	token: string;
	/** Raw, untrusted argument object from the agent. */
	rawArgs: unknown;
	/**
	 * The calling Pi agent's live model, forwarded by the Pi extension. Absent for
	 * every MCP caller. Only a hint for spawned conversations — the caller's own
	 * runtime comes from its control origin and its persisted session, neither of
	 * which an agent supplies.
	 */
	callerModel?: string;
	/**
	 * Aborts when the caller goes away mid-call, so an op that blocks on a human
	 * or a child can stop instead of finishing for nobody. Both bridges supply
	 * one — the MCP bridge forwards the request's own signal, which the SDK
	 * aborts on a cancellation notice or a dropped connection — so a question
	 * whose client gave up comes off screen rather than waiting for an answer
	 * nobody will receive. Optional for a caller that cannot be cancelled.
	 *
	 * Every wait on this surface honours it: the questionnaire and the approval
	 * prompt on the human side, `waitForAgents` and a `wait: true` spawn on the
	 * child side. The approval prompt is native and cannot be withdrawn from
	 * here, so what the signal buys there is that a click landing after the
	 * caller has gone runs nothing.
	 */
	signal?: AbortSignal;
}

/** Public surface of the agent-control service. */
export interface AgentControlService {
	invoke: (
		command: AgentControlCommand,
	) => Promise<AgentControlResult<unknown>>;
	/**
	 * Resolves who a token's caller is, for the bridges that shape a whole surface
	 * to the caller rather than validating one call: the MCP tool list and the
	 * playbook served alongside it. Identity stays the service's to resolve, so a
	 * bridge never reaches into the origin registry itself. A token that resolves
	 * to nothing reads as a harness root — the narrowest first-class-free surface,
	 * and every call it goes on to make is refused anyway.
	 */
	describeAudience: (token: string) => Promise<ControlAudience>;
	/**
	 * Renders this turn's prompt additions for a session the app drives itself:
	 * the naming upkeep block, and the directive putting the agent's prose in the
	 * app's language.
	 *
	 * Pi pulls both over `getSessionBrief` from its own extension, but a runtime
	 * whose only channel is MCP has no per-turn hook to pull them from — its
	 * playbook is appended once, at session open. Without this the branch bullet
	 * never reaches it and the branch is never named, and a language switched
	 * mid-session never lands.
	 * @param sessionId - The agent session the preamble describes.
	 * @returns The text to prepend to the turn, or null when there is none.
	 */
	readTurnPreamble: (sessionId: string) => Promise<string | null>;
	/**
	 * Renders the language directive on its own, for the surfaces that inject a
	 * playbook once and have no per-turn channel to revise it: the MCP server's
	 * `instructions` field and the harness playbook file.
	 * @returns The directive to append, or null when the app is in English.
	 */
	readLanguageDirective: () => string | null;
	/**
	 * Renders the commit co-author directive on its own, for the same
	 * inject-once surfaces {@link readLanguageDirective} serves. Takes no caller
	 * argument because the credit is a global app setting rather than a property
	 * of the workspace or the session.
	 * @returns The directive to append, or null when the credit is off.
	 */
	readCoAuthorDirective: () => string | null;
	/**
	 * Renders the linked-issue directive for one caller, for the MCP server's
	 * `instructions` field — the only per-workspace channel a caller whose whole
	 * surface is MCP has. Takes a token rather than a session id because that is
	 * what an MCP request carries, and the workspace behind it is what decides
	 * whether there is an issue to name at all.
	 * @param token - The caller's bearer token.
	 * @returns The directive to append, or null when there is no Linear issue or the token is unknown.
	 */
	readIssueDirective: (token: string) => Promise<string | null>;
	/**
	 * Releases all per-session state (pending orchestrator signal, spawn
	 * counters, origin token) when an agent session ends, keeping the in-memory
	 * maps bounded. Idempotent; safe to call for unknown sessions.
	 */
	releaseSession: (sessionId: string) => void;
	/**
	 * Narrows a Concierge session's origin to the memory-write turn a clear left
	 * it running for, without dropping its token — the child still needs to reach
	 * the control server to have its writes cleared. Idempotent; safe to call for
	 * unknown sessions.
	 */
	retireSession: (sessionId: string) => void;
}

/**
 * Clock + sleep injection for the blocking `waitForAgents` poll loop. Defaults to
 * the real wall clock and `setTimeout`; tests inject deterministic versions.
 */
export interface WaitScheduler {
	now: () => number;
	sleep: (ms: number) => Promise<void>;
}

/** Collaborators for {@link createAgentControlService}. */
interface AgentControlServiceOptions {
	ports: AgentControlPorts;
	originRegistry: OriginRegistry;
	guardrails: Guardrails;
	/**
	 * Whether the architecture diagram feature is on, read live rather than
	 * captured: it is a user setting the app watches, and the answer gates both
	 * the two diagram ops and the playbook that describes them. Defaults to off,
	 * so a build that never wires it keeps the feature absent.
	 */
	readArchitectureDiagramEnabled?: () => boolean;
	/**
	 * Overrides the service clock and sleep; defaults to the real scheduler. Its
	 * `now` drives both the wait-loop deadline and the review-focus coalescing
	 * window, so a test can hold either still.
	 */
	scheduler?: WaitScheduler;
	/**
	 * Overrides how long a non-blocking op may run before the app answers for it;
	 * tests scale it down. Defaults to {@link DISPATCH_TIMEOUT_MS}.
	 */
	dispatchTimeoutMs?: number;
}

/**
 * Runs one control op. Args arrive pre-validated against the op's schema, so a
 * handler may cast them to its own argument shape.
 */
type OpHandler = (input: {
	args: unknown;
	callerModel: string | undefined;
	origin: AgentControlOrigin;
	signal: AbortSignal | undefined;
}) => Promise<AgentControlResult<unknown>> | AgentControlResult<unknown>;

/** Session statuses that mean a Pi child has stopped working. */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
	'idle',
	'closed',
	'errored',
]);

/** Signal reasons that should wake a blocking wait immediately. */
const ATTENTION_REASONS: ReadonlySet<string> = new Set([
	'need_decision',
	'blocked',
]);

/** How often the blocking wait re-checks child status and pending signals. */
const WAIT_POLL_MS = 250;

/** Default real-clock scheduler for the wait loop. */
const REAL_SCHEDULER: WaitScheduler = {
	/** Reads the wall clock the wait loop measures its deadline against. */
	now: () => Date.now(),
	/** Suspends the wait loop for one poll interval. */
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Wraps a payload in a success envelope.
 * @param data - Operation payload.
 * @returns A success result.
 */
function ok<T>(data: T): AgentControlResult<T> {
	return { ok: true, data };
}

/**
 * Told to an agent whose approval prompt outlived the call that raised it. The
 * dialog is native and cannot be taken off screen from here, so the guarantee is
 * the one that matters: a click that lands after the caller has gone runs
 * nothing.
 */
const ABANDONED_CONFIRMATION =
	'The call was abandoned before the user answered the approval prompt, so the op did not run. Nothing was changed — ask again if you still need it.';

/** Terminal kind a third-party CLI harness runs in, as `listTerminals` reports it. */
const HARNESS_TERMINAL_KIND = 'agent';

/** Terminal status of a session whose process is still alive. */
const RUNNING_TERMINAL_STATUS = 'running';

/** Tab title an agent-opened review takes when the caller names none. */
const DEFAULT_REVIEW_TAB_TITLE = 'Review';

/**
 * Renders what an agent reads back after opening a review.
 *
 * Four things it cannot work out for itself, and each one costs a wasted turn if
 * it is missing. The review is a root rather than a child, so the ops that default
 * to "every child you spawned" do not cover it and it has to be named in
 * `targets`. It delegates its own readers, so a wide change does not make it slow.
 * It shares the worktree, so writing while it works is how two agents lose each
 * other's edits. And a `fallback` brief means the user's own review instructions
 * and model pin never reached it, which belongs in the agent's report rather than
 * being silently absorbed.
 *
 * The last three caveats are about the user's configured review settings, and
 * every way one of them degrades is named rather than absorbed. The model is
 * honoured across runtimes, so a caller on one runtime routinely opens a review
 * on the other and should say so rather than reporting a review it believes ran
 * beside it. A pin the catalogue no longer carries falls back to the caller's own
 * model, which is a weaker review than the one the user configured. And a
 * configured thinking level the resolved model has no rung for is dropped for the
 * spawn's own model, which is the same class of silent downgrade as the model
 * one — the reason the level had to be dropped is that `selectionFor` refuses the
 * spawn outright otherwise, not that the level did not matter.
 * @param input - The review session, the runtime it opened on when that is not the
 *   caller's, whether a stale model pin was dropped, the configured thinking level
 *   the resolved model would not take, and whether a window composed the brief or
 *   main fell back.
 * @returns The message returned alongside the session and tab ids.
 */
function startedReviewMessage(input: {
	agentSessionId: string;
	crossRuntime: AgentProviderId | null;
	droppedModel: boolean;
	droppedThinkingLevel: string | null;
	source: 'renderer' | 'fallback';
}): string {
	const caveats = [
		input.source === 'fallback'
			? "No Ensemblr window answered in time, so this review runs on the built-in guidelines and the repository's committed review preferences only — the user's personal review instructions and their configured review model did not reach it."
			: '',
		input.droppedModel
			? "The model the user configured for reviews is no longer in this app's catalogue, so this review runs on yours instead — it is still the user's review prompt, on a model they did not pick."
			: '',
		input.crossRuntime
			? `This review runs on the ${getAgentProviderLabel(input.crossRuntime)} runtime rather than yours, because that is where the model the user configured for reviews lives. Nothing about steering it changes.`
			: '',
		input.droppedThinkingLevel
			? `The "${input.droppedThinkingLevel}" thinking level the user configured for reviews is not a rung on that model's ladder — the two runtimes do not share one — so this review opens at the level the spawn fell back to rather than the one they set.`
			: '',
	].filter(Boolean);
	const reported = caveats.length
		? ` ${caveats.join(' ')} Say so in your report.`
		: '';
	return `Opened this workspace's Review conversation, running the same review the user's Review button runs. It is a root orchestrator rather than one of your children, so \`ensemblr_wait_for_agents\` will not find it unless you name \`targets: ["${input.agentSessionId}"]\` — wait on it that way, and \`ensemblr_send_follow_up\` against the same id steers it. It has a delegation budget of its own and fans readers out over a wide diff. It shares this worktree with you: leave the files alone until it reports, and do the committing and the pull request yourself.${reported}`;
}

/**
 * The thinking level to open the review on: the user's configured one, unless
 * the model it will actually run on has no such rung.
 *
 * Two settings that are set independently and can therefore disagree. When the
 * pinned model resolved, the level is checked against *that* model's ladder —
 * the two runtimes do not share one, so a level configured beside a Pi model is
 * routinely absent from a Claude Code model's, and `selectionFor` refuses a spawn
 * outright rather than coercing it. Dropping the level costs the review one
 * setting; forwarding it would cost the user the review. A `null` here is a
 * degradation rather than an absence, so {@link handleStartReview} tells the two
 * apart by the brief and {@link startedReviewMessage} reports it — the level is
 * the user's setting exactly as the model is, and swapping it for the caller's
 * silently is the same defect one layer down.
 *
 * When no model resolved the level is forwarded as it always was. The pair are
 * independent preferences, and a user who set only a level would otherwise lose
 * it — the level is then the caller's own inherited model's problem, which is
 * where it has always been.
 * @param brief - The composed brief, carrying the user's configured pair.
 * @param pinned - The catalogue row the pinned model resolved to, or null.
 * @returns The level to open on, or null to let the spawn inherit the caller's.
 */
function reviewThinkingLevel(
	brief: ReviewLaunchBrief,
	pinned: AgentControlModelInfo | null,
): string | null {
	if (!brief.thinkingLevel || !pinned) {
		return brief.thinkingLevel;
	}
	return pinned.thinkingLevels.includes(brief.thinkingLevel)
		? brief.thinkingLevel
		: null;
}

/**
 * Renders what an agent reads back when it already had a review open.
 *
 * A settled outcome rather than a refusal, and the wording carries that: the
 * caller asked for a reviewer and is handed one, so nothing about the call
 * failed. It reads as an `ok` for the same reason `setName` does when the user
 * has titled the tab themselves — the app answered the intent, not the literal
 * request.
 * @param agentSessionId - The review this caller already has open.
 * @returns The message returned alongside that session and its tab.
 */
function reusedReviewMessage(agentSessionId: string): string {
	return `You already have a review open on this workspace, and this is it: session \`${agentSessionId}\`, handed back rather than replaced by a second reader. Steer it with \`ensemblr_send_follow_up\` against that id — send it the findings to fix, or the rebuilt change to read again. It holds every round that led here, where a reviewer opened now would re-read the whole diff from cold to arrive where this one is already standing. Nothing was spawned, so this cost you no spawn quota.`;
}

/**
 * Builds a failure envelope.
 * @param code - Stable failure code.
 * @param error - Human-readable reason.
 * @returns A failure result.
 */
function fail(
	code: AgentControlErrorCode,
	error: string,
): AgentControlResult<never> {
	return { ok: false, code, error };
}

/**
 * Cuts one `setSummary` field to its limit rather than refusing the submission.
 * A summary is the most token-heavy payload on the surface and exists to survive
 * the turn, so an over-long one is stored short with the loss reported back —
 * rejecting it costs a multi-kilobyte re-emit and risks losing the record.
 * @param field - Which field is being clamped, for the report.
 * @param value - The agent's submitted text.
 * @param limit - Its ceiling from {@link SET_SUMMARY_LIMITS}.
 * @returns The text to store, plus what was cut when anything was.
 */
function clampSummaryField(
	field: SetSummaryTruncation['field'],
	value: string,
	limit: number,
): { text: string; truncated?: SetSummaryTruncation } {
	if (value.length <= limit) {
		return { text: value };
	}
	return {
		text: sliceWholeCharacters(value, limit),
		truncated: { field, limit, submittedLength: value.length },
	};
}

/**
 * Cuts a string to a code-unit limit without splitting a surrogate pair. A plain
 * `slice` on a summary that ends on an emoji at the boundary stores a lone
 * surrogate, which is not a character any reader of the record can render.
 * @param value - The text to cut.
 * @param limit - Ceiling in UTF-16 code units.
 * @returns The text cut to at most `limit` units, one shorter when the cut landed inside a pair.
 */
function sliceWholeCharacters(value: string, limit: number): string {
	const cut = value.slice(0, limit);
	const lastUnit = cut.charCodeAt(cut.length - 1);
	const splitsAPair = lastUnit >= 0xd800 && lastUnit <= 0xdbff;
	return splitsAPair ? cut.slice(0, -1) : cut;
}

/**
 * Says what `setSummary` cut, one clause per field. Both fields can be over at
 * once, and a caller told about only one of them would resubmit the other
 * unchanged and be cut again.
 * @param truncations - Every field that was clamped, in submission order.
 * @returns The sentence appended to the record's own message.
 */
function describeSummaryTruncations(
	truncations: readonly SetSummaryTruncation[],
): string {
	const listed = truncations
		.map(
			({ field, limit, submittedLength }) =>
				`the ${field} was ${submittedLength} characters against a cap of ${limit}`,
		)
		.join(', and ');
	const outcome =
		truncations.length > 1
			? 'each was stored truncated rather than rejected — write them shorter next time.'
			: 'it was stored truncated rather than rejected — write it shorter next time.';
	return `${listed.charAt(0).toUpperCase()}${listed.slice(1)}, so ${outcome}`;
}

/**
 * Control-envelope code for each way a script launch declines, so a caller can
 * branch on the outcome before reading the prose: a name that resolves to
 * nothing is `not-found`, a run script already holding the workspace is
 * `conflict`, and a restart that outlasts its wait is `timeout`.
 */
const START_TERMINAL_ERROR_CODES: Readonly<
	Record<string, AgentControlErrorCode>
> = {
	'database-unavailable': 'internal',
	'script-already-running': 'conflict',
	'script-not-configured': 'not-found',
	'script-restart-timeout': 'timeout',
	'workspace-not-found': 'not-found',
};

/**
 * Maps a script-lifecycle diagnostic code onto the control envelope's code.
 * @param code - The diagnostic code the lifecycle service reported.
 * @returns The matching control error code, or `internal` for an unmapped one.
 */
function startTerminalErrorCode(code: string): AgentControlErrorCode {
	return START_TERMINAL_ERROR_CODES[code] ?? 'internal';
}

/**
 * Maps an architecture refusal onto the code an agent branches on. Only
 * `invalid` is the caller's own doing, so only it may report `invalid-args` —
 * that code precedes an instruction to fix the fields and resubmit, which for a
 * failed write sends the agent to rewrite a document that was already correct,
 * forever. `unreadable` is `conflict` rather than `internal` because nothing is
 * broken in the app: a tracked file is in a state that blocks the read, and only
 * the user can clear it.
 */
const ARCHITECTURE_FAILURE_CODES: Readonly<
	Record<ArchitectureFailureReason, AgentControlErrorCode>
> = {
	invalid: 'invalid-args',
	'store-failed': 'internal',
	unavailable: 'internal',
	unreadable: 'conflict',
};

/**
 * Closes a refused launch with the id of the terminal it collided with. The
 * lifecycle service knows exactly which session is holding the slot, and an
 * agent that cannot see the dock has no other way to reach it — withholding it
 * costs a `listTerminals` round trip to recover what the refusal already knew.
 * @param message - The lifecycle diagnostic's own prose.
 * @param terminalId - The session already holding the slot, when there is one.
 * @returns The message an agent receives.
 */
function describeStartTerminalRefusal(
	message: string,
	terminalId: string | undefined,
): string {
	return terminalId
		? `${message} It is terminal ${terminalId}: read it with ensemblr_read_terminal_output, stop it with ensemblr_stop_terminal, or pass restart: true to replace it.`
		: message;
}

/**
 * Whether a child's pending signal is one only the orchestrator can clear.
 * @param signal - The child's pending signal, or null when it has none.
 * @returns True for `need_decision` and `blocked`.
 */
function needsAttention(signal: OrchestratorSignal | null): boolean {
	return signal !== null && ATTENTION_REASONS.has(signal.reason);
}

/**
 * Whether a `mode: "all"` wait may return. Every target settling is the ordinary
 * case; a child asking for a decision releases the wait too, because the caller
 * is the only one who can answer it and its still-running siblings would
 * otherwise hold the question there until the wait timeout expires.
 * @param settled - Per-target settle state from the current poll tick.
 * @returns True when the wait may return.
 */
function waitAllSatisfied(
	settled: readonly { agent: WaitedAgent; settled: boolean }[],
): boolean {
	return (
		settled.every((entry) => entry.settled) ||
		settled.some((entry) => needsAttention(entry.agent.signal))
	);
}

/**
 * Names the targets a wait is leaving behind, so the caller can wait on exactly
 * those next instead of polling each child's status.
 * @param settled - Per-target settle state from the poll tick that returned.
 * @returns The unsettled targets and their current status.
 */
function stillRunning(
	settled: readonly { agent: WaitedAgent; settled: boolean }[],
): PendingAgent[] {
	return settled.flatMap((entry) =>
		entry.settled
			? []
			: [
					{
						agentSessionId: entry.agent.agentSessionId,
						status: entry.agent.status,
					},
				],
	);
}

/**
 * Assembles a wait result, attaching the instruction that a timed-out wait is a
 * lap of the loop rather than a failure. A child doing real work outlives the
 * app's wait ceiling routinely, and a bare `timedOut: true` reads to an
 * orchestrator as something to report to the user or work around — so the call
 * that resumes the wait travels as prose, the same reason a shortened report
 * carries its own re-fetch pointer. The note echoes the caller's own mode, because
 * a caller that chose `first` to react to whichever child lands first did not ask
 * to start blocking on all of them.
 * @param outcome - The settled children, the ones still running, whether the window expired, and the mode the caller waited in.
 * @returns The wait result, with a resume note when one is warranted.
 */
/**
 * The result of a wait with nothing to wait on. When the caller named its targets
 * and got none, that is a settled answer. When it let the default stand and the
 * lineage registry came back empty, it may instead have lost its children to a
 * restart — that registry is in-memory — so the note says how to recover rather
 * than letting a signalling child's escalation land in a wait that reads nothing.
 * @param defaulted - True when the caller omitted `targets` and the registry resolved empty.
 * @returns An empty wait result, with a recovery note when the lineage may be lost.
 */
function emptyWait(defaulted: boolean): WaitForAgentsResult {
	const result = { completed: [], pending: [], timedOut: false };
	if (!defaulted) {
		return result;
	}
	return {
		...result,
		note: 'No children are registered to this session. If you spawned children earlier and the app has restarted since, that lineage is gone and the default target cannot find them — wait again with their agentSessionIds in `targets`, taken from the ensemblr_start_conversation results earlier in this conversation, or read a report directly with ensemblr_get_last_message.',
	};
}

function waitOutcome(outcome: {
	completed: readonly WaitedAgent[];
	pending: readonly PendingAgent[];
	timedOut: boolean;
	mode: WaitMode;
}): WaitForAgentsResult {
	const { mode, ...result } = outcome;
	if (!result.timedOut || result.pending.length === 0) {
		return result;
	}
	const targets = result.pending
		.map((entry) => `"${entry.agentSessionId}"`)
		.join(', ');
	return {
		...result,
		note: `Not a failure: the wait window expired while ${result.pending.length} child(ren) were still working. Keep waiting with ensemblr_wait_for_agents({ mode: "${mode}", targets: [${targets}] }).`,
	};
}

/**
 * Confirms a resolved workspace matches the caller's, for the scope checks every
 * op that names a resource by id runs before touching it.
 * @param actualWorkspaceId - Owning workspace of the target, or null when missing.
 * @param origin - Resolved caller identity.
 * @returns Null when in scope, otherwise a failure envelope.
 */
function outOfScope(
	actualWorkspaceId: string | null,
	origin: AgentControlOrigin,
): AgentControlResult<never> | null {
	if (actualWorkspaceId === null) {
		return fail('not-found', 'Target resource does not exist.');
	}
	// The Concierge is the deliberate exception to "writes act only on the
	// caller's own workspace": it has no workspace, and supervising every project
	// is what it is for. Its own boundary is elsewhere — the tool policy that
	// keeps every file write inside the Concierge home.
	if (origin.concierge) {
		return null;
	}
	if (actualWorkspaceId !== origin.workspaceId) {
		return fail(
			'denied-scope',
			'Access is limited to the agent’s own workspace.',
		);
	}
	return null;
}

/**
 * Creates the agent-control service.
 * @param options - Ports, origin registry, and guardrails.
 * @returns A service exposing a single `invoke` entry point.
 */
export function createAgentControlService({
	ports,
	originRegistry,
	guardrails,
	readArchitectureDiagramEnabled = () => false,
	scheduler = REAL_SCHEDULER,
	dispatchTimeoutMs = DISPATCH_TIMEOUT_MS,
}: AgentControlServiceOptions): AgentControlService {
	/** Latest pending signal per child session id, set by `notifyOrchestrator`. */
	const signalsByChild = new Map<string, OrchestratorSignal>();

	/**
	 * Sessions that have searched Linear at least once, which is the precondition
	 * on filing an issue. Session state rather than port state on purpose: the
	 * Linear port is stateless and knows nothing of who is calling it, and this is
	 * a fact about the caller's own turn rather than about the tracker.
	 */
	const linearSearchesBySession = new Set<string>();

	/**
	 * Peer spawns per workspace that have cleared the cap and are still opening,
	 * which is the window in which the workspace looks emptier than it is. Held
	 * here rather than derived, because the thing being counted is a spawn in
	 * flight and nothing else in the app records one.
	 */
	const peerSpawnsOpening = new Map<string, number>();

	/**
	 * The review each caller has already opened, so a second `startReview` reaches
	 * that reviewer instead of seating a fresh one beside it.
	 *
	 * A second review is not a second child like any other: it is another agent
	 * over the *same whole diff*, so its files are guaranteed to overlap the first
	 * one's, and both write — fixing what they found on a follow-up is the point.
	 * The rest of the app answers concurrent children with "brief them onto
	 * disjoint files", which is exactly the answer this op cannot give. The
	 * co-tenancy cap used to make the second call impossible on its own; since
	 * [ADR 0063](../../../docs/adr/0063-open-an-agent-requested-review-as-a-peer-again.md)
	 * widened that cap for an unattended caller a second reviewer fits through it,
	 * so this map is what refuses one — and it has to, because the unattended
	 * loop's own re-entry path walks back through a step that says to call this op.
	 *
	 * Keyed by caller rather than by workspace: a peer running alongside is a
	 * different orchestrator with its own reading to have done, and handing it the
	 * reviewer briefed for somebody else's half would be the wrong answer.
	 */
	const reviewsByCaller = new Map<
		string,
		{ agentSessionId: string; chatTabId: string }
	>();

	/**
	 * Sessions this service opened as a review, which are the ones refused a
	 * `startReview` of their own.
	 *
	 * The reverse index of {@link reviewsByCaller}, held because the forward map
	 * answers "what did this caller open" and the refusal asks "is this caller
	 * something somebody opened". A reviewer is a root, so nothing else about it
	 * says no: {@link SUBAGENT_BLOCKED_OPS} refused the op while it was a child,
	 * and since it became a peer again the widened unattended allowance leaves
	 * room for the review-of-a-review chain that refusal used to bound.
	 */
	const openedReviewSessions = new Set<string>();

	/**
	 * Workspace-and-model pairs the user has already approved a frontier-tier
	 * spawn for, so a fan-out of five children onto the model they just said yes
	 * to raises one dialog rather than five. Held for the life of the process and
	 * keyed by workspace, because "yes, run this here" is not a licence for the
	 * workspace next door.
	 *
	 * Declines are deliberately not remembered. Nothing here can be un-remembered
	 * without restarting the app, so a remembered "no" would outlive the user
	 * changing their mind; the refusal tells the agent not to ask again instead,
	 * which is the same lever {@link gatePeerSpawn} pulls.
	 */
	const approvedFrontierSpawns = new Set<string>();

	/** Pulls the review panel to Checks after a comment op, once per burst. */
	const reviewFocus = createReviewFocus(ports.focus, scheduler.now);

	/**
	 * Whether the caller is a chat conversation that is currently planning. Plan
	 * Mode is a native chat-tab feature, so a caller without one is never planning
	 * however its session id happens to resolve.
	 * @param origin - Resolved caller identity.
	 * @returns True when Plan Mode governs this caller's turn.
	 */
	const isPlanning = (origin: AgentControlOrigin): boolean =>
		originHasChatTab(origin) && ports.planMode.isActive(origin.sessionId);

	/**
	 * Whether the user has stepped away from the caller's conversation. Gated on
	 * the chat tab for the reason {@link isPlanning} is: AFK is a composer toggle,
	 * so a caller without a composer is never unattended however its session id
	 * happens to resolve.
	 * @param origin - Resolved caller identity.
	 * @returns True when AFK governs this caller's turn.
	 */
	const isUnattended = (origin: AgentControlOrigin): boolean =>
		originHasChatTab(origin) && ports.afkMode.isActive(origin.sessionId);

	/**
	 * The refinement directive for a planning caller whose plan is already in
	 * front of the user, so the turn carrying their answer is told to end in
	 * another submission rather than in prose.
	 * @param origin - Resolved caller identity.
	 * @returns The directive to append, or null when no plan is under review.
	 */
	const readPlanRefinement = (origin: AgentControlOrigin): string | null =>
		isPlanning(origin) && ports.planMode.hasSubmittedPlan(origin.sessionId)
			? PLAN_REFINEMENT_DIRECTIVE
			: null;

	/**
	 * The delegation directive for a planning caller, which answers the harness's
	 * own plan-mode instructions in the vocabulary they use.
	 *
	 * Rendered from the mechanism the session was pinned to at open and the
	 * caller's role, because the answer inverts across both: a root on `native`
	 * is told its workflow's fan-out is correct, a root on `ensemblr` is told
	 * which tool replaced it, and an investigator holds neither.
	 *
	 * Takes the role rather than resolving it, because the preamble it belongs to
	 * builds a second block off the same answer and resolving one costs a database
	 * read.
	 * @param origin - Resolved caller identity.
	 * @param role - The caller's already-resolved control-layer role.
	 * @returns The directive to append, or null when the caller is not planning.
	 */
	const planDelegationFor = (
		origin: AgentControlOrigin,
		role: AgentControlRole,
	): string | null =>
		isPlanning(origin)
			? buildPlanModeDelegationDirective({
					delegation: origin.delegation,
					role,
				})
			: null;

	/**
	 * This turn's language directive, read from the setting rather than captured
	 * so a language switched mid-session reaches the next turn.
	 * @returns The directive to append, or null when the app is in English.
	 */
	const readLanguageDirective = (): string | null =>
		buildLanguageDirective(ports.language.getLanguage());

	/**
	 * This turn's commit co-author block, read from the setting rather than
	 * captured so a credit toggled mid-session reaches the next turn.
	 * @returns The directive to append, or null when the credit is off.
	 */
	const readCoAuthorDirective = (): string | null =>
		buildCoAuthorDirective(ports.commitCredit.isCoAuthorEnabled());

	/**
	 * The caller's control-layer role. Prefers the sub-agent marker its spawn
	 * persisted on its chat tab over live lineage, because lineage does not
	 * survive a restart: `parentSessionId` is not stored, so a resumed session
	 * re-registers at depth 0, while Plan Mode is restored from the renderer's
	 * per-tab store. Without the durable marker a restored investigator would come
	 * back holding the orchestrator policy and could submit a plan, question the
	 * user, or delegate onward — the three ops that policy exists to deny it.
	 * @param origin - Resolved caller identity.
	 * @returns The role that selects which half of the plan-mode policy applies.
	 */
	const resolveRole = async (
		origin: AgentControlOrigin,
	): Promise<AgentControlRole> => {
		// Asked before the marker read, which costs a database round trip: a
		// Concierge can never carry a sub-agent marker, so resolving one would be
		// spending a query to learn something the origin already said.
		if (origin.concierge) {
			return 'concierge';
		}
		return resolveAgentRole(
			await ports.conversations.isSpawnedSubAgent(origin.sessionId),
			origin.depth,
		);
	};

	/**
	 * This turn's linked-issue directive, cut to what the caller may actually do to
	 * a tracker. Rendered per turn rather than captured because both inputs move:
	 * Plan Mode toggles mid-session, and a sub-agent marker is written when a child
	 * is spawned.
	 * @param origin - Resolved caller identity.
	 * @param role - The caller's already-resolved control-layer role.
	 * @returns The directive to append, or null when the workspace has no Linear issue.
	 */
	const issueDirectiveFor = (
		origin: AgentControlOrigin,
		role: AgentControlRole,
	): string | null =>
		buildLinkedIssueDirective(
			ports.linear.readLinkedIssue(origin.workspaceId),
			role,
			isPlanning(origin),
		);

	/**
	 * The linked-issue directive for a caller reached by token, which has no other
	 * reason to have resolved a role and so pays for one here.
	 * @param origin - Resolved caller identity.
	 * @returns The directive to append, or null when the workspace has no Linear issue.
	 */
	const readIssueDirectiveForOrigin = async (
		origin: AgentControlOrigin,
	): Promise<string | null> =>
		issueDirectiveFor(origin, await resolveRole(origin));

	/**
	 * Blocks the ops that belong to the orchestrator rather than to the one unit of
	 * work a child was handed, whatever mode it is in. Runs before the plan-mode
	 * gate because the role is a durable fact about the session while planning is a
	 * property of the turn, so a sub-agent should hear why it is a sub-agent rather
	 * than why it is planning.
	 *
	 * This is what a sub-agent used to be denied only by accident: the spawn
	 * guardrail refusing `origin.depth >= 1`. That counter lives in an in-memory
	 * registry, so a session resumed after a restart came back at depth 0 holding
	 * the whole surface again.
	 *
	 * The op is checked before the role because resolving the role reads the tab
	 * marker out of the database, and this runs on every dispatch: an op no role is
	 * denied costs nothing to clear.
	 * @param op - The control op being dispatched.
	 * @param origin - Resolved caller identity.
	 * @returns A denial envelope, or null when the op may proceed.
	 */
	const gateSubAgentRole = async (
		op: AgentControlOp,
		origin: AgentControlOrigin,
	): Promise<AgentControlResult<never> | null> => {
		if (origin.concierge) {
			// Ahead of the Concierge list rather than folded into it: retirement is
			// a state the same origin passes through, and it withdraws ops the
			// Concierge otherwise holds for as long as it lasts.
			const retiredDenial = origin.retired ? retiredControlOpDenial(op) : null;
			if (retiredDenial !== null) {
				return fail('denied-scope', retiredDenial);
			}
			const conciergeDenial = conciergeControlOpDenial(op);
			return conciergeDenial === null
				? null
				: fail('denied-scope', conciergeDenial);
		}
		const denial = subAgentControlOpDenial(op);
		if (denial === null) {
			return null;
		}
		return (await resolveRole(origin)) === 'subagent'
			? fail('denied-scope', denial)
			: null;
	};

	/**
	 * Blocks the control ops a planning agent must not reach. The Pi extension
	 * intercepts `bash`, `edit`, and `write`, but Ensemblr's own tools can open a
	 * terminal, launch a harness, or drive another conversation — each of which
	 * puts an unrestricted writer on the same workspace. Policy splits by role: a
	 * planning orchestrator may fan out read-only investigators, a planning
	 * sub-agent may not delegate, submit a plan, or question the user.
	 *
	 * This is not the whole plan-mode policy. `sendFollowUp` from an orchestrator
	 * depends on whether its target is itself planning, which cannot be resolved
	 * before the workspace scope check, so `handleSendFollowUp` owns that half.
	 * @param op - The control op being dispatched.
	 * @param origin - Resolved caller identity.
	 * @returns A denial envelope, or null when the op may proceed.
	 */
	const gatePlanMode = async (
		op: AgentControlOp,
		origin: AgentControlOrigin,
	): Promise<AgentControlResult<never> | null> => {
		if (!isPlanning(origin)) {
			return null;
		}
		const denial = planModeControlOpDenial(op, await resolveRole(origin));
		return denial === null ? null : fail('denied-scope', denial);
	};

	const gateAfkMode = (
		op: AgentControlOp,
		origin: AgentControlOrigin,
	): AgentControlResult<never> | null => {
		if (!isUnattended(origin)) {
			return null;
		}
		const denial = afkModeControlOpDenial(op);
		return denial === null ? null : fail('denied-scope', denial);
	};

	const gatePermission = async (
		op: AgentControlOp,
		origin: AgentControlOrigin,
		signal: AbortSignal | undefined,
	): Promise<AgentControlResult<never> | null> => {
		const action = isWriteOp(op) ? 'app-control-write' : 'app-control-read';
		const mode = ports.permissions.getMode();
		const boundary = classifyPermissionAction({ action, mode }).boundary;
		if (boundary === 'blocked') {
			return fail('denied-permission', `Blocked by ${mode} permission mode.`);
		}
		if (boundary !== 'confirmation-required') {
			return null;
		}
		// The user is away, so the dialog this would raise has nobody to answer it
		// and the op would hang until they came back. Deliberately reaches only the
		// `confirmation-required` boundary: a `blocked` one is still blocked above,
		// so AFK answers a question the mode already allows rather than widening it.
		if (isUnattended(origin)) {
			return null;
		}
		const approved = await ports.confirm.confirm({
			origin,
			signal,
			summary: `Agent requests ${op} in workspace ${origin.workspaceId}.`,
		});
		if (signal?.aborted) {
			return fail('timeout', ABANDONED_CONFIRMATION);
		}
		if (!approved) {
			return fail('denied-permission', 'The user declined the request.');
		}
		return null;
	};

	/**
	 * Checks a spawn op against depth/quota/rate without consuming quota.
	 * @param origin - Resolved caller identity.
	 * @returns A denial envelope, or null when the spawn may proceed.
	 */
	const evaluateSpawnGuard = (
		origin: AgentControlOrigin,
	): AgentControlResult<never> | null => {
		const verdict = guardrails.evaluateSpawn(origin);
		return verdict.ok ? null : fail(verdict.code, verdict.reason);
	};

	const waitIfRequested = async (
		agentSessionId: string,
		wait: boolean | undefined,
		signal: AbortSignal | undefined,
	): Promise<'completed' | 'timeout' | undefined> => {
		if (!wait) {
			return undefined;
		}
		return ports.conversations.waitForIdle(
			agentSessionId,
			guardrails.waitTimeoutMs,
			signal,
		);
	};

	/**
	 * Resolves the workspace an op should act on, and its working directory.
	 *
	 * A workspace agent has exactly one and may not name another, so an explicit
	 * `workspaceId` from it is refused rather than honoured — otherwise the
	 * optional argument the Concierge needs would become a way around the scope
	 * rule for everyone. The Concierge has none of its own, so it must name one,
	 * and an op that names none is refused rather than defaulted into the empty
	 * string, which every downstream service reads as a workspace that exists and
	 * holds nothing.
	 *
	 * A named target is looked up in the workspace list rather than trusted, so an
	 * id that no longer exists fails as `not-found` instead of writing a board row
	 * nothing renders or reaching git with an empty path.
	 *
	 * An op that also names a tab or terminal passes that resource's owning
	 * workspace as `owner`, which stands in for an argument the caller left out.
	 * The two disagreeing is refused rather than resolved by precedence: whichever
	 * won, the caller asked for the other one.
	 * @param origin - Resolved caller identity.
	 * @param named - The `workspaceId` the op's args carried, if any.
	 * @param owner - Workspace owning the resource the op names, if it names one.
	 * @returns The workspace id and cwd, or a failure envelope.
	 */
	const resolveTargetWorkspace = async (
		origin: AgentControlOrigin,
		named: string | undefined,
		owner: string | null = null,
	): Promise<
		| { cwd: string; workspaceId: string }
		| { failure: AgentControlResult<never> }
	> => {
		if (named && owner && named !== owner) {
			return {
				failure: fail(
					'denied-scope',
					'The tab or terminal you named lives in a different workspace than `workspaceId` does. Drop `workspaceId` — the resource already says which workspace it is in.',
				),
			};
		}
		const target = named ?? owner ?? null;
		if (!origin.concierge) {
			if (target && target !== origin.workspaceId) {
				return {
					failure: fail(
						'denied-scope',
						'Access is limited to the agent’s own workspace, so `workspaceId` may not name another one.',
					),
				};
			}
			return { cwd: origin.workspaceCwd, workspaceId: origin.workspaceId };
		}
		if (!target) {
			return {
				failure: fail(
					'invalid-args',
					'You have no workspace of your own, so this op needs an explicit `workspaceId`. `ensemblr_list_workspaces` returns the ids.',
				),
			};
		}
		const match = (await ports.workspaces.listWorkspaces()).find(
			(workspace) => workspace.workspaceId === target,
		);
		return match
			? { cwd: match.cwd, workspaceId: match.workspaceId }
			: { failure: fail('not-found', 'No such workspace.') };
	};

	const handleSpawnChatTab = async (
		origin: AgentControlOrigin,
		args: SpawnChatTabArgs,
	): Promise<AgentControlResult<unknown>> => {
		const spawnDenied = evaluateSpawnGuard(origin);
		if (spawnDenied) {
			return spawnDenied;
		}
		const created = await ports.tabs.spawnChatTab({
			workspaceId: origin.workspaceId,
			title: args.title,
		});
		guardrails.recordSpawn(origin.sessionId);
		return ok(created);
	};

	/**
	 * Names the root orchestrators already working a workspace, which is what the
	 * peer cap is really about — concurrent agents on one checkout, not
	 * conversations that once existed.
	 *
	 * Two exclusions, and both are the difference between a live writer and a row
	 * in a map. Only a chat-tab species is a conversation at all: a terminal
	 * launch registers one workspace-scoped `harness` origin so a CLI the user
	 * starts by hand can reach the control server, and that one is minted by the
	 * first terminal of any kind — a dev server included — and never released, so
	 * counting it would spend the workspace's whole allowance on a run script.
	 * {@link liveHarnessTerminals} counts the harnesses that are actually running
	 * instead. And the durable marker separates a root from a sub-agent exactly as
	 * {@link resolveRole} does it, because a resumed sub-agent re-registers at
	 * depth 0 and would otherwise refuse a peer the workspace has room for.
	 * @param workspaceId - Workspace to count in.
	 * @returns The session ids of the root orchestrators live there now.
	 */
	const rootsInWorkspace = async (
		workspaceId: string,
	): Promise<readonly string[]> => {
		const sessions = originRegistry
			.originsInWorkspace(workspaceId)
			.flatMap((origin) =>
				originHasChatTab(origin) ? [origin.sessionId] : [],
			);
		const marks = await Promise.all(
			sessions.map((sessionId) =>
				ports.conversations.isSpawnedSubAgent(sessionId),
			),
		);
		return sessions.filter((_, index) => !marks[index]);
	};

	/**
	 * Names the harness terminals running in a workspace right now.
	 *
	 * A harness is an unrestricted writer on the same checkout, so it counts
	 * against the peer cap for the reason the cap exists. It is counted from the
	 * live terminal list rather than from its control origin because that origin
	 * is one per workspace and permanent, which answers "a terminal was opened
	 * here once" — a question the cap does not ask.
	 * @param workspaceId - Workspace to count in.
	 * @returns The terminal ids of the harnesses running there now.
	 */
	const liveHarnessTerminals = async (
		workspaceId: string,
	): Promise<readonly string[]> => {
		const terminals = await ports.terminals
			.listTerminals({ workspaceId })
			.catch(() => []);
		return terminals.flatMap((terminal) =>
			terminal.kind === HARNESS_TERMINAL_KIND &&
			terminal.status === RUNNING_TERMINAL_STATUS
				? [terminal.terminalId]
				: [],
		);
	};

	/**
	 * Takes a slot in the workspace's co-tenancy allowance for a spawn that has
	 * cleared the cap but not yet opened.
	 *
	 * What both callers share is the window: the count is read before the spawn,
	 * and the conversation registers an origin of its own only once it is open, so
	 * in between the workspace looks emptier than it is. Two spawns issued in one
	 * parallel tool block would both read the same count and both pass. The
	 * reservation is what they contend on instead.
	 *
	 * The window is a different length for each. {@link gatePeerSpawn} holds it
	 * across a confirmation prompt that blocks with no time limit, which is what
	 * this was built for; {@link handleStartReview} raises no prompt and holds it
	 * across the compose, the model lookup and the spawn. Shorter, but not short
	 * enough to skip — a review is a writer on the checkout the moment it opens.
	 * @param workspaceId - Workspace the spawn is opening into.
	 * @returns The release, which is idempotent so a `finally` may call it freely.
	 */
	const reservePeerSlot = (workspaceId: string): (() => void) => {
		const held = peerSpawnsOpening.get(workspaceId) ?? 0;
		peerSpawnsOpening.set(workspaceId, held + 1);
		let released = false;
		return () => {
			if (released) {
				return;
			}
			released = true;
			const remaining = (peerSpawnsOpening.get(workspaceId) ?? 1) - 1;
			if (remaining > 0) {
				peerSpawnsOpening.set(workspaceId, remaining);
			} else {
				peerSpawnsOpening.delete(workspaceId);
			}
		};
	};

	/**
	 * Renders the refusal a full workspace answers a peer spawn with, naming what
	 * is in it and what to do about each.
	 *
	 * The two kinds of occupant take different answers, so listing them together
	 * would send an agent to steer a terminal id `ensemblr_send_follow_up` cannot
	 * reach. A conversation is steerable; a harness is the user's to close.
	 *
	 * The limit is stated as the caller's own allowance rather than as the
	 * workspace's occupancy, because {@link coTenantLimit} reads the caller and
	 * the two can disagree: an unattended run legitimately seats three, the user
	 * comes back, and the next attended spawn is held to two in a workspace that
	 * holds more than two. Phrased as arithmetic — "already holds its limit of
	 * two" over three named occupants — that reads as a bug the agent can falsify
	 * by counting. The number stays, because an agent that cannot see the
	 * allowance cannot tell a full workspace from a broken op.
	 * @param limit - The allowance applied to this caller, which its turn mode widens.
	 * @param roots - Session ids of the orchestrators already in the workspace.
	 * @param harnesses - Terminal ids of the harnesses running there.
	 * @returns The model-facing denial message.
	 */
	const workspaceFullRefusal = (
		limit: number,
		roots: readonly string[],
		harnesses: readonly string[],
	): string => {
		const occupants = [
			roots.length > 0
				? `${roots.length} orchestrator${roots.length > 1 ? 's' : ''} (${roots.join(', ')}), which you can steer with \`ensemblr_send_follow_up\``
				: '',
			harnesses.length > 0
				? `${harnesses.length} running harness terminal${harnesses.length > 1 ? 's' : ''} (${harnesses.join(', ')}), which only the user can close`
				: '',
		].filter(Boolean);
		return `This workspace is full for you: your allowance is ${limit} agents writing one checkout, and it already holds ${occupants.join(' and ')}. They share one worktree and one git index, and nothing arbitrates a further writer. Work with what is there, or do the work in this conversation.`;
	};

	/**
	 * How many uncoordinated writers this caller's workspace may hold at once.
	 *
	 * Read off the caller rather than off the workspace, because the wider
	 * unattended allowance answers a need the unattended run has and an attended
	 * orchestrator beside it does not
	 * ([ADR 0063](../../../docs/adr/0063-open-an-agent-requested-review-as-a-peer-again.md)).
	 * The delivery loop keeps a review peer open across every round it runs, so
	 * two slots are spent before it has room for anything the user left behind —
	 * and the two things they routinely leave, a harness terminal still running
	 * and a peer opened earlier, are exactly what the extra two absorb. A run
	 * script is not one of them: {@link liveHarnessTerminals} counts terminals of
	 * kind `agent`, so a dev server has never taken a slot.
	 * @param origin - Resolved caller identity, whose turn mode picks the limit.
	 * @returns The co-tenancy limit to hold this caller to.
	 */
	const coTenantLimit = (origin: AgentControlOrigin): number =>
		isUnattended(origin)
			? PEER_ORCHESTRATOR_LIMITS.maxPerUnattendedWorkspace
			: PEER_ORCHESTRATOR_LIMITS.maxPerWorkspace;

	/**
	 * Takes a slot in the workspace's co-tenancy allowance, or refuses because the
	 * checkout is already full.
	 *
	 * What the cap counts is *uncoordinated* writers: roots and running harnesses,
	 * none of which knows what the others are editing. A spawned sub-agent is not
	 * one — the orchestrator that opened it blocks on it and sequences it against
	 * its own edits — which is why {@link rootsInWorkspace} excludes the durably
	 * marked ones. {@link handleStartReview} does come through here: the reviewer
	 * is a root with a delegation budget of its own, so it is a writer nothing
	 * sequences, and {@link coTenantLimit} is what keeps that affordable for the
	 * unattended loop rather than an exemption from the count.
	 * @param origin - Resolved caller identity, naming the workspace to count in.
	 * @returns The reservation to release once the conversation is open, or the denial.
	 */
	const reserveCoTenantSlot = async (
		origin: AgentControlOrigin,
	): Promise<AgentControlResult<never> | (() => void)> => {
		const [roots, harnesses] = await Promise.all([
			rootsInWorkspace(origin.workspaceId),
			liveHarnessTerminals(origin.workspaceId),
		]);
		const opening = peerSpawnsOpening.get(origin.workspaceId) ?? 0;
		const limit = coTenantLimit(origin);
		if (roots.length + harnesses.length + opening >= limit) {
			return fail(
				'denied-quota',
				workspaceFullRefusal(limit, roots, harnesses),
			);
		}
		return reservePeerSlot(origin.workspaceId);
	};

	/**
	 * Whether a named model is the costliest tier, read off the catalog row
	 * rather than off the id.
	 *
	 * The row is what `ensemblr_list_models` classifies, so reading it here is
	 * what stops the listing and the gate disagreeing about which ids are
	 * `frontier`. It matters because a runtime may advertise a moving alias whose
	 * id says nothing about the family it currently resolves to — Claude Code
	 * publishes exactly those, and the picker names such a row after its
	 * `resolvedModel`, so the display name is the only place the family appears.
	 *
	 * A row the catalog cannot supply falls back to the bare id rather than to
	 * `standard`: an unreadable catalog, or an id from a runtime the spawn
	 * resolver is about to refuse anyway, must never be the thing that turns the
	 * gate off. The catalog read is memoized behind its own TTL, and only a spawn
	 * that named a model reaches it.
	 * @param origin - Resolved caller identity, naming the runtime to list.
	 * @param modelId - The model the caller named.
	 * @returns True when opening a child on it would escalate onto the frontier tier.
	 */
	const namesFrontierModel = async (
		origin: AgentControlOrigin,
		modelId: string,
	): Promise<boolean> => {
		const listing = await ports.conversations
			.listModels({ runtime: originRuntime(origin) })
			.catch(() => null);
		const row = listing?.models.find((model) => model.id === modelId);
		return isFrontierAgentModel(row ?? { id: modelId });
	};

	/**
	 * Decides whether a child may be opened on the costliest tier of model, and
	 * asks the user when it would be.
	 *
	 * Only a model the caller *named* reaches this gate. Inheriting is never
	 * gated: the model a conversation already runs on is one the user chose, and
	 * confirming every delegation out of a Fable chat would make the tier
	 * unusable rather than deliberate. What is gated is the escalation — an agent
	 * reaching past what it was given onto the tier that costs several times
	 * more. The other way onto that tier without anyone choosing it, a spawn that
	 * named nothing falling through to a catalog default, is closed in
	 * `defaultModelFor` instead, because there is no one to ask there either.
	 *
	 * Raised whatever the permission mode, for the reason {@link gatePeerSpawn}'s
	 * is: `workspace-trusted` is the user trusting an agent with their files, not
	 * with their bill.
	 *
	 * A remembered approval is checked before the tier is, so the fan-out it was
	 * given for costs one catalog read rather than one per child. The set only
	 * ever holds keys a frontier classification put there, so answering from it
	 * cannot wave through a model that was never gated.
	 * @param origin - Resolved caller identity.
	 * @param input - The workspace the child opens in and the model it named.
	 * @param signal - Aborts when the spawning turn ends, withdrawing the prompt.
	 * @returns A denial envelope, or null when the spawn may proceed.
	 */
	const gateFrontierModelSpawn = async (
		origin: AgentControlOrigin,
		input: { modelId: string | undefined; workspaceId: string },
		signal: AbortSignal | undefined,
	): Promise<AgentControlResult<never> | null> => {
		const modelId = input.modelId;
		if (!modelId) {
			return null;
		}
		const approvalKey = `${input.workspaceId}:${modelId}`;
		if (approvedFrontierSpawns.has(approvalKey)) {
			return null;
		}
		if (!(await namesFrontierModel(origin, modelId))) {
			return null;
		}
		if (isUnattended(origin)) {
			return fail(
				'denied-permission',
				`"${modelId}" is the costliest tier of model and a child is not opened on it without the user's say-so — and they are away, so nobody can be asked. Omit "model" to inherit the one this conversation already runs on, or pass an id ensemblr_list_models reports as tier "standard". Say in your final message that you wanted this model and why.`,
			);
		}
		const approved = await ports.confirm
			.confirm({
				origin,
				signal,
				summary: `Open a conversation on "${modelId}"? It is the costliest tier of model, and this agent chose it rather than inheriting the one it runs on.`,
			})
			.catch(() => false);
		if (signal?.aborted) {
			return fail('timeout', ABANDONED_CONFIRMATION);
		}
		if (!approved) {
			return fail(
				'denied-permission',
				`The user declined to open a conversation on "${modelId}". Spawn without "model" to inherit the one you run on, or pass an id ensemblr_list_models reports as tier "standard" — and do not ask for this model again unless they raise it.`,
			);
		}
		approvedFrontierSpawns.add(approvalKey);
		return null;
	};

	/**
	 * Decides whether a peer orchestrator may be opened, and asks the user.
	 *
	 * "The user explicitly asked for this" cannot be a judgement the spawning agent
	 * makes about its own prompt, so it is not asked to make it: passing `peer`
	 * states an intent, and the confirmation is what turns that into authority. The
	 * prompt is raised whatever the permission mode, unlike
	 * {@link gatePermission}'s — `workspace-trusted` is the user trusting an agent
	 * with its own workspace, which is not the same as trusting it to put a second
	 * writer in there.
	 *
	 * The cap is what bounds the recursion. A peer is a root and looks like one to
	 * every other gate, so "peers may not open peers" is not a rule the app could
	 * check; a second peer is refused because the workspace already holds its
	 * allowance, which is the same answer for a better reason.
	 * @param origin - Resolved caller identity.
	 * @param signal - Aborts when the spawning turn ends, withdrawing the prompt.
	 * @returns The reservation to release once the peer is open, or the denial.
	 */
	const gatePeerSpawn = async (
		origin: AgentControlOrigin,
		signal: AbortSignal | undefined,
	): Promise<AgentControlResult<never> | (() => void)> => {
		if (origin.concierge) {
			return fail(
				'invalid-args',
				'Drop `peer`: what `ensemblr_start_conversation` opens for you is already a root orchestrator with its own delegation budget, in the workspace you name. `peer` is for an orchestrator opening a second one alongside itself.',
			);
		}
		if (isPlanning(origin)) {
			return fail(
				'denied-scope',
				'A peer orchestrator is a second writer on this worktree, and you are planning — there is nothing yet for two agents to write. Say in the plan that the work splits in two, and open the peer once the plan is approved.',
			);
		}
		const reserved = await reserveCoTenantSlot(origin);
		if (typeof reserved !== 'function') {
			return reserved;
		}
		const release = reserved;
		// Not auto-approved the way `gatePermission`'s confirmation is. A peer is
		// only ever opened because the USER asked for one, and that premise cannot
		// hold while they are away — so this refuses rather than waiting on a dialog
		// nobody will answer, and two unsupervised writers never land on one
		// worktree.
		if (isUnattended(origin)) {
			release();
			return fail(
				'denied-permission',
				'A peer orchestrator is a second writer on this worktree and is only ever opened because the user asked for one — and they are away, so nobody can be asked. Do the work in this conversation, and say in your final message that you wanted a peer and why.',
			);
		}
		const approved = await ports.confirm
			.confirm({
				origin,
				signal,
				summary:
					'Open a second orchestrator in this workspace? It shares the worktree and git index with this conversation.',
			})
			.catch(() => false);
		if (signal?.aborted) {
			release();
			return fail('timeout', ABANDONED_CONFIRMATION);
		}
		if (!approved) {
			release();
			return fail(
				'denied-permission',
				'The user declined to open a peer orchestrator. Do the work in this conversation instead, and do not ask again unless they raise it.',
			);
		}
		return release;
	};

	/**
	 * Why a caller may not state the turn mode its spawn opens in.
	 *
	 * Concierge-only, because every other caller already passes its own mode down
	 * and has no reason to override it. An attended orchestrator opting a child
	 * into AFK would be opting it into auto-approved permission confirmations with
	 * no user behind the decision, and the Concierge is the only caller that
	 * cannot inherit — it holds no composer chip of its own.
	 * @param origin - Resolved caller identity.
	 * @param args - The spawn's arguments.
	 * @returns The refusal reason, or null when the caller may state a mode.
	 */
	const spawnModeDenial = (
		origin: AgentControlOrigin,
		args: StartConversationArgs,
	): string | null => {
		const statesMode =
			args.planMode !== undefined || args.afkMode !== undefined;
		if (!statesMode || origin.concierge) {
			return null;
		}
		return 'Only the Concierge states the mode a conversation opens in. What you spawn inherits your own: it plans when you are planning, and it runs unattended when the user has stepped away from this chat. Drop `planMode` and `afkMode`.';
	};

	/**
	 * Opens a delegated conversation. A model the spawn cannot honour — one from
	 * another agent runtime, or none inferable at all — comes back as an argument
	 * failure naming the runtime, because the calling agent can fix that on its
	 * next turn and an `internal` envelope reads as a fault to retry verbatim.
	 *
	 * A Concierge delegates through this op and through nothing else, so the
	 * workspace is an argument here rather than the caller's own: it has none, and
	 * spawning into the empty string would put an agent with no control token and
	 * no guard in a directory nobody is watching. Its own flag rides along because
	 * the port cannot infer it and two things downstream turn on it: what it opens
	 * is a root orchestrator rather than a sub-agent, and its model is read from
	 * the Concierge session service rather than from a session row it has none of.
	 * @param origin - Resolved caller identity.
	 * @param args - Prompt, optional tab, model, thinking level, title, wait flag,
	 *   and — for a Concierge — the workspace and the turn mode it opens in.
	 * @param callerModel - The Pi extension's live-model hint, absent for MCP callers.
	 * @param signal - Aborts when the spawning turn ends, so a `wait: true` poll
	 *   stops instead of watching a child for a caller that has gone.
	 * @returns The spawned conversation, or the reason it was refused.
	 */
	const handleStartConversation = async (
		origin: AgentControlOrigin,
		args: StartConversationArgs,
		callerModel: string | undefined,
		signal: AbortSignal | undefined,
	): Promise<AgentControlResult<unknown>> => {
		let owner: string | null = null;
		if (args.chatTabId) {
			owner = await ports.tabs.resolveTabWorkspace(args.chatTabId);
			const scoped = outOfScope(owner, origin);
			if (scoped) {
				return scoped;
			}
		}
		const target = await resolveTargetWorkspace(
			origin,
			args.workspaceId,
			owner,
		);
		if ('failure' in target) {
			return target.failure;
		}
		const spawnDenied = evaluateSpawnGuard(origin);
		if (spawnDenied) {
			return spawnDenied;
		}
		const modeDenied = spawnModeDenial(origin, args);
		if (modeDenied) {
			return fail('invalid-args', modeDenied);
		}
		// After the argument checks, so a call that was never valid does not raise a
		// dialog first; ahead of the peer gate so a refusal here never strands a
		// reserved co-tenancy slot, and so the user is not asked to seat a second
		// orchestrator before being asked what it would cost to run.
		const frontierDenied = await gateFrontierModelSpawn(
			origin,
			{ modelId: args.model, workspaceId: target.workspaceId },
			signal,
		);
		if (frontierDenied) {
			return frontierDenied;
		}
		const asPeer = args.peer === true;
		let releasePeerSlot: (() => void) | null = null;
		if (asPeer) {
			const gated = await gatePeerSpawn(origin, signal);
			if (typeof gated !== 'function') {
				return gated;
			}
			releasePeerSlot = gated;
		}
		// Held until the child is open, because that is when it registers an origin
		// of its own and starts being counted by the gate above.
		const started = await ports.conversations
			.startConversation({
				workspaceId: target.workspaceId,
				workspaceCwd: target.cwd,
				asPeer,
				chatTabId: args.chatTabId,
				prompt: asPeer
					? `${buildPeerBriefDirective(origin.sessionId)}\n\n---\n\n${args.prompt}`
					: args.prompt,
				model: args.model,
				thinkingLevel: args.thinkingLevel,
				title: args.title,
				callerConcierge: origin.concierge,
				callerModel,
				callerRuntime: originRuntime(origin),
				parentSessionId: origin.sessionId,
				// Unreachable defence today, and deliberately so: `spawnModeDenial`
				// refuses both flags from every caller that inherits a mode, and the
				// Concierge, which is the only one that may pass them, has no composer
				// chip to inherit from — so the two operands are never both live. It is
				// an OR rather than a coalesce so that a Concierge which later gains a
				// mode of its own cannot open a child *less* restricted than itself; a
				// coalesce would invert that the day such a chip lands.
				planMode: isPlanning(origin) || args.planMode === true,
				afkMode: isUnattended(origin) || args.afkMode === true,
			})
			.finally(() => releasePeerSlot?.());
		if (!started.ok) {
			return fail('invalid-args', started.reason);
		}
		guardrails.recordSpawn(origin.sessionId);
		const result = await waitIfRequested(
			started.agentSessionId,
			args.wait,
			signal,
		);
		return ok({
			agentSessionId: started.agentSessionId,
			chatTabId: started.chatTabId,
			result,
		});
	};

	/**
	 * The catalogue row for the model the user configured for reviews, looked up
	 * across every runtime rather than only the caller's.
	 *
	 * The review model and its thinking level are one app-level preference the
	 * user sets once, and nothing ties either to whatever runtime a given
	 * workspace agent happens to run on. So the review is opened on the runtime
	 * the *model* belongs to, and the search covers both: a Pi orchestrator whose
	 * user reviews on Claude Code gets the review they configured, not the nearest
	 * thing its own runtime could offer.
	 *
	 * That is a deliberate exception to the rule {@link resolveRequested} enforces
	 * for `startConversation`, where a cross-runtime model is refused because an
	 * orchestrator asking for one has misunderstood its own children. Here nobody
	 * asked: the model came from the user's settings, and honouring it is the
	 * whole value of the op. {@link handleStartReview} withholds the caller's
	 * runtime from the spawn to say so, which is the same shape the Concierge
	 * spawns in.
	 *
	 * The row rather than the id, because the caller needs two more facts off it:
	 * which runtime the review will open on, and whether the configured thinking
	 * level is one this model's ladder accepts — the two runtimes do not share a
	 * ladder, and a level the model refuses sinks the whole spawn.
	 *
	 * `runtime: null` is the argument that makes the search cover every runtime,
	 * and it is the right one rather than the loose one: the listing is narrowed to
	 * a runtime so that a caller only sees models it may spawn a child on, and this
	 * pin is the user's rather than the caller's. Narrowing it to the caller's
	 * runtime would reinstate exactly the bug this resolves. One call also means
	 * one catalogue build — `list()` is rebuilt per call rather than cached, and it
	 * shells out to `pi --list-models` to do it, so a search that asked per runtime
	 * paid for the same merged catalogue twice.
	 * @param requested - The model the brief carried, or null when it carried none.
	 * @returns The catalogue row, or null when no model is pinned or the
	 *   catalogue no longer carries the pinned one.
	 */
	const reviewModelRow = async (
		requested: string | null,
	): Promise<AgentControlModelInfo | null> => {
		if (!requested) {
			return null;
		}
		const listing = await ports.conversations
			.listModels({ runtime: null })
			.catch(() => null);
		return listing?.models.find((model) => model.id === requested) ?? null;
	};

	/**
	 * Reports the review this caller already opened, when there is still a
	 * conversation behind it in this workspace.
	 *
	 * `resolveConversationWorkspace` is the whole probe, and it answers the right
	 * question rather than a stricter one: the session row
	 * outlives the reviewer going idle and outlives its tab being closed, and
	 * `sendFollowUp` reaches it in both of those states, so both are a reviewer the
	 * caller still has. Only a session that no longer exists at all — a deleted
	 * workspace, a cleared database — falls through to a fresh spawn, and the stale
	 * entry is dropped on the way past so the next call does not probe it again.
	 *
	 * A probe that *throws* is read as still-there rather than gone, which is the
	 * one place here the safe answer is not the strict one. Handing back an id
	 * whose follow-up then fails costs the caller a turn and a `not-found` it can
	 * act on; opening a duplicate reviewer over the same whole diff is the harm
	 * this map exists to prevent, and nothing downstream detects it.
	 *
	 * Two `startReview` calls issued in one parallel tool block can both read an
	 * empty map, and this lookup does nothing to stop them. What partly does is
	 * {@link reserveCoTenantSlot}, which the op now goes through: the reservation
	 * is taken in the same synchronous run as the count it clears, so the second
	 * call to resume always sees the first's slot, and an attended caller one slot
	 * from full has the duplicate refused as `denied-quota`. Partly, because that
	 * is arithmetic rather than mutual exclusion — where the allowance has room
	 * for both, as an unattended caller's four does, both reservations succeed and
	 * both spawn.
	 *
	 * No tighter guard here, because the window is two short awaits rather than
	 * {@link gatePeerSpawn}'s confirmation dialog, and nothing has a reason to
	 * batch this op with itself. The path the loop actually walks is sequential, a
	 * turn or more apart, and that one this closes outright.
	 * @param origin - Resolved caller identity, naming the caller and its workspace.
	 * @returns The open review's session and tab, or null when there is none.
	 */
	const reusableReview = async (
		origin: AgentControlOrigin,
	): Promise<{ agentSessionId: string; chatTabId: string } | null> => {
		const open = reviewsByCaller.get(origin.sessionId);
		if (!open) {
			return null;
		}
		const owner = await ports.conversations
			.resolveConversationWorkspace(open.agentSessionId)
			.catch(() => origin.workspaceId);
		if (owner === origin.workspaceId) {
			return open;
		}
		reviewsByCaller.delete(origin.sessionId);
		return null;
	};

	/**
	 * Composes the review brief and opens the conversation, inside the co-tenancy
	 * reservation {@link handleStartReview} holds around it.
	 *
	 * Split out so that reservation is a `try`/`finally` over one call rather than
	 * over the whole body: the release has no other decrement, and a compose that
	 * throws would otherwise strand a slot for the life of the process.
	 * @param origin - Resolved caller identity.
	 * @param args - The optional tab title.
	 * @param callerModel - The Pi extension's live-model hint, absent for MCP callers.
	 * @returns The review session and tab, or a failure envelope.
	 */
	const openReview = async (
		origin: AgentControlOrigin,
		args: StartReviewArgs,
		callerModel: string | undefined,
	): Promise<AgentControlResult<unknown>> => {
		const brief = await ports.reviewLaunch.composeBrief({
			workspaceCwd: origin.workspaceCwd,
			workspaceId: origin.workspaceId,
		});
		const pinned = await reviewModelRow(brief.model);
		const thinkingLevel = reviewThinkingLevel(brief, pinned);
		const started = await ports.conversations.startConversation({
			afkMode: isUnattended(origin),
			asPeer: true,
			callerConcierge: false,
			callerModel,
			// Withheld when the user pinned a review model, which is what lets the
			// spawn open on that model's own runtime: `resolveRequested` refuses a
			// cross-runtime model only against a caller runtime it can see, and here
			// the model is the user's rather than the caller's to have chosen.
			callerRuntime: pinned ? null : originRuntime(origin),
			model: pinned?.id,
			parentSessionId: origin.sessionId,
			planMode: false,
			prompt: `${buildReviewPeerDirective(origin.sessionId)}\n\n---\n\n${brief.prompt}`,
			thinkingLevel: thinkingLevel ?? undefined,
			title: args.title ?? DEFAULT_REVIEW_TAB_TITLE,
			workspaceCwd: origin.workspaceCwd,
			workspaceId: origin.workspaceId,
		});
		if (!started.ok) {
			return fail('invalid-args', started.reason);
		}
		guardrails.recordSpawn(origin.sessionId);
		reviewsByCaller.set(origin.sessionId, {
			agentSessionId: started.agentSessionId,
			chatTabId: started.chatTabId,
		});
		openedReviewSessions.add(started.agentSessionId);
		return ok({
			agentSessionId: started.agentSessionId,
			chatTabId: started.chatTabId,
			message: startedReviewMessage({
				agentSessionId: started.agentSessionId,
				crossRuntime:
					pinned && pinned.runtime !== originRuntime(origin)
						? pinned.runtime
						: null,
				droppedModel: brief.model !== null && pinned === null,
				droppedThinkingLevel:
					brief.thinkingLevel !== null && thinkingLevel === null
						? brief.thinkingLevel
						: null,
				source: brief.source,
			}),
		} satisfies StartReviewResult);
	};

	/**
	 * Opens the app's own Review conversation over the caller's workspace and
	 * hands back the session to wait on.
	 *
	 * What it opens is a **root orchestrator**, not a sub-agent, and that is the
	 * point rather than an implementation detail
	 * ([ADR 0063](../../../docs/adr/0063-open-an-agent-requested-review-as-a-peer-again.md)).
	 * A review of a wide change is itself delegable work, and a reviewer that
	 * cannot spawn readers of its own reads a fifty-file diff in one window or not
	 * at all. It costs a slot in the workspace's co-tenancy allowance for exactly
	 * the reason a peer does — it is a second writer on one checkout — and what
	 * keeps that affordable for the unattended loop, which holds a reviewer open
	 * across every round it runs, is {@link coTenantLimit} widening the allowance
	 * for an unattended caller rather than this op stepping outside the count.
	 *
	 * A reviewer may not open a review, and {@link openedReviewSessions} is what
	 * holds that. While the reviewer was a child {@link SUBAGENT_BLOCKED_OPS}
	 * refused the op; as a root nothing else does, and the widened unattended
	 * allowance leaves room for the chain — orchestrator, reviewer, reviewer's
	 * reviewer — that the attended cap of two closed by arithmetic. Refused ahead
	 * of everything else, because a caller that is itself a review has no reuse
	 * entry to be handed and no reason to reach the reservation.
	 *
	 * One review per caller, and {@link reusableReview} is what holds that: a
	 * caller that already has one is handed it back as an `ok`, ahead of the
	 * co-tenancy reservation, the spawn guardrail and the compose, because reusing
	 * spends none of them. Two reviewers are two writers over the same whole diff,
	 * where the app's usual answer to concurrent agents is to brief them onto
	 * disjoint files — and a wider allowance is what would otherwise let a second
	 * one through.
	 *
	 * The review runs on the model and thinking level the user configured for
	 * reviews, wherever those live — {@link reviewModelRow} resolves the pin across
	 * both runtimes and the spawn withholds the caller's own runtime so it can open
	 * there. A caller on one runtime routinely opens a review on the other, and
	 * only a pin the catalogue has lost falls back to the caller's own model.
	 *
	 * The Concierge and a spawned sub-agent are refused it by
	 * {@link CONCIERGE_BLOCKED_OPS} and {@link SUBAGENT_BLOCKED_OPS}: neither has
	 * a workspace whose change is its own to have reviewed.
	 *
	 * Unlike {@link gatePeerSpawn} it raises no confirmation and is not refused
	 * while the user is away. A peer is a second writer the *agent* chose, so
	 * "the user asked for this" has to be established by a dialog; this is the
	 * Review action the user already has a button for, composed from their own
	 * settings and running on the model they picked for reviews. Asking them to
	 * confirm their own review — and refusing it overnight, when the unattended
	 * loop is the one that most needs a second reader — would be gating the wrong
	 * thing.
	 * @param origin - Resolved caller identity.
	 * @param args - The optional tab title.
	 * @param callerModel - The Pi extension's live-model hint, absent for MCP callers.
	 * @returns The review session and tab, or a failure envelope.
	 */
	const handleStartReview = async (
		origin: AgentControlOrigin,
		args: StartReviewArgs,
		callerModel: string | undefined,
	): Promise<AgentControlResult<unknown>> => {
		if (openedReviewSessions.has(origin.sessionId)) {
			return fail(
				'denied-scope',
				'You are the review. The change in this workspace is already under review — by you — so opening another one would seat a third writer over the same whole diff to read what you were opened to read. Report what you found, and let the orchestrator that opened you decide what happens to the change.',
			);
		}
		const open = await reusableReview(origin);
		if (open) {
			return ok({
				...open,
				message: reusedReviewMessage(open.agentSessionId),
			} satisfies StartReviewResult);
		}
		const spawnDenied = evaluateSpawnGuard(origin);
		if (spawnDenied) {
			return spawnDenied;
		}
		const reserved = await reserveCoTenantSlot(origin);
		if (typeof reserved !== 'function') {
			return reserved;
		}
		// Held until the review is open, because that is when it registers an origin
		// of its own and starts being counted by the reservation above — and
		// released on every path out, including a throwing compose, because
		// `peerSpawnsOpening` has no other decrement and a slot lost here is lost
		// for the life of the process.
		try {
			return await openReview(origin, args, callerModel);
		} finally {
			reserved();
		}
	};

	/**
	 * Names the caller's own conversation tab. A title the user chose outranks
	 * the agent and is reported as settled rather than failed, so the agent reads
	 * "leave it alone" instead of a fault worth retrying. Chat tabs only: a
	 * harness owns a terminal tab whose title is derived from its own session log,
	 * so there is nothing here for it to rename.
	 * @param origin - Resolved caller identity.
	 * @param args - The requested title.
	 * @returns The resulting title and whether the rename landed.
	 */
	const handleSetName = async (
		origin: AgentControlOrigin,
		args: SetNameArgs,
	): Promise<AgentControlResult<unknown>> => {
		if (!originHasChatTab(origin)) {
			return fail(
				'denied-scope',
				'Naming a tab is limited to native chat conversations; your tab is named from your own session log.',
			);
		}
		const result = await ports.conversations.setName({
			agentSessionId: origin.sessionId,
			name: args.title,
		});
		if (!result) {
			return fail(
				'not-found',
				'Cannot name this tab: the calling conversation is not active.',
			);
		}
		return ok({
			...result,
			message: result.applied
				? 'Named this tab.'
				: 'This tab was named by the user; their title stands and nothing changed.',
		} satisfies SetNameResult & { chatTabId: string });
	};

	/**
	 * Names the caller's workspace and its git branch. A workspace the user (or
	 * an earlier agent) already named is reported as settled rather than failed:
	 * a failure envelope reads to a model like a transient fault worth retrying,
	 * and there is nothing here to retry.
	 *
	 * Root callers only, which {@link gateSubAgentRole} enforces before dispatch:
	 * the workspace name and its git branch describe the whole body of work and
	 * outlive any one delegated unit of it. The session brief withholds the branch
	 * bullet from a sub-agent for the same reason, so a child never sees the upkeep
	 * block ask for this.
	 * @param origin - Resolved caller identity.
	 * @param args - The requested slug.
	 * @returns Whether the name was applied, or an `invalid-args` failure the agent can act on.
	 */
	const handleSetBranchName = async (
		origin: AgentControlOrigin,
		args: SetBranchNameArgs,
	): Promise<AgentControlResult<unknown>> => {
		try {
			return ok(
				await ports.sessionNaming.setBranchName({
					origin,
					slug: args.name,
					userRequested: args.userRequested === true,
				}),
			);
		} catch (error) {
			if (error instanceof BranchSlugRejected) {
				return fail('invalid-args', error.message);
			}
			throw error;
		}
	};

	/**
	 * Records what the conversation has covered so far. Restricted to callers with
	 * a chat tab: the summary belongs to the tab bound to the calling session, and
	 * a harness has no such tab.
	 * @param origin - Resolved caller identity.
	 * @param args - The summary title and markdown body.
	 * @returns The point in the conversation the summary now covers.
	 */
	const handleSetSummary = async (
		origin: AgentControlOrigin,
		args: SetSummaryArgs,
	): Promise<AgentControlResult<unknown>> => {
		if (!originHasChatTab(origin)) {
			return fail(
				'denied-scope',
				'Recording a session summary is limited to native chat conversations.',
			);
		}
		const summary = clampSummaryField(
			'summary',
			args.summary,
			SET_SUMMARY_LIMITS.maxSummaryLength,
		);
		const title = clampSummaryField(
			'title',
			args.title,
			SET_SUMMARY_LIMITS.maxTitleLength,
		);
		const recorded = await ports.sessionNaming.setSummary({
			origin,
			summary: summary.text,
			title: title.text,
		});
		const truncated = [summary.truncated, title.truncated].filter(
			(entry): entry is SetSummaryTruncation => entry !== undefined,
		);
		if (truncated.length === 0) {
			return ok(recorded);
		}
		return ok({
			...recorded,
			message: `${recorded.message} ${describeSummaryTruncations(truncated)}`,
			truncated,
		} satisfies SetSummaryResult);
	};

	/**
	 * Reads the caller's workspace architecture diagram, answering with a null
	 * document for a workspace nobody has drawn. Nothing derives one, so the
	 * message that comes back with the absence tells the agent to author it
	 * rather than to go looking for a scanner it does not hold.
	 * @param origin - Resolved caller identity.
	 * @returns The diagram, or a failure.
	 */
	const handleGetArchitectureDiagram = async (
		origin: AgentControlOrigin,
	): Promise<AgentControlResult<unknown>> => {
		if (!(readArchitectureDiagramEnabled() && ports.architecture)) {
			return fail(
				'denied-scope',
				'This build keeps no architecture diagram, so there is none to read.',
			);
		}
		const outcome = await ports.architecture.readDiagram({ origin });
		return outcome.ok
			? ok(outcome.result)
			: fail(ARCHITECTURE_FAILURE_CODES[outcome.reason], outcome.message);
	};

	/**
	 * Replaces the caller's workspace architecture diagram with a refined one.
	 * @param origin - Resolved caller identity.
	 * @param args - The submitted diagram document.
	 * @returns What was stored, or a failure the agent can correct.
	 */
	const handleUpdateArchitectureDiagram = async (
		origin: AgentControlOrigin,
		args: UpdateArchitectureDiagramArgs,
	): Promise<AgentControlResult<unknown>> => {
		if (!(readArchitectureDiagramEnabled() && ports.architecture)) {
			return fail(
				'denied-scope',
				'This build keeps no architecture diagram, so there is nothing to update.',
			);
		}
		const outcome = await ports.architecture.updateDiagram({
			diagram: args.diagram,
			origin,
		});
		return outcome.ok
			? ok(outcome.result)
			: fail(ARCHITECTURE_FAILURE_CODES[outcome.reason], outcome.message);
	};

	/**
	 * Reports everything the Pi extension needs to assemble a turn's system
	 * prompt in one round trip: whether the session is planning, what naming
	 * upkeep it still owes, the rendered upkeep block to append, the language
	 * directive to append with it, and the role playbook when the caller's is one
	 * the extension does not hold.
	 * @param origin - Resolved caller identity.
	 * @returns The session brief.
	 */
	const handleGetSessionBrief = async (
		origin: AgentControlOrigin,
	): Promise<AgentControlResult<unknown>> => {
		const naming = await ports.sessionNaming.readBrief(origin);
		const planMode = isPlanning(origin);
		const afkMode = isUnattended(origin);
		const role = await resolveRole(origin);
		return ok({
			afkDirective: buildAfkDirective(afkMode),
			afkMode,
			afkWorkflowDirective: buildAfkWorkflowDirective({
				delegation: origin.delegation,
				role,
				unattended: afkMode,
			}),
			issueDirective: issueDirectiveFor(origin, role),
			languageDirective: readLanguageDirective(),
			naming,
			nudge: buildSessionBriefNudge(naming, planMode),
			planMode,
			planRefinement: readPlanRefinement(origin),
			rolePlaybook: origin.concierge ? CONCIERGE_AWARENESS : null,
		} satisfies GetSessionBriefResult);
	};

	/**
	 * Steers another conversation. A planning caller may only reach a target that
	 * is itself planning, so delegation cannot be laundered into an edit through a
	 * conversation that is not restricted. The plan-mode check runs after the scope
	 * check on purpose: answering it earlier would tell a caller in another
	 * workspace whether a session it cannot see is planning.
	 * @param origin - Resolved caller identity.
	 * @param args - Target session, prompt, and whether to block on it.
	 * @param signal - Aborts when the steering turn ends, so a `wait: true` poll
	 *   stops instead of watching a child for a caller that has gone.
	 * @returns The wait outcome, or a denial envelope.
	 */
	const handleSendFollowUp = async (
		origin: AgentControlOrigin,
		args: SendFollowUpArgs,
		signal: AbortSignal | undefined,
	): Promise<AgentControlResult<unknown>> => {
		const owner = await ports.conversations.resolveConversationWorkspace(
			args.agentSessionId,
		);
		const scoped = outOfScope(owner, origin);
		if (scoped) {
			return scoped;
		}
		if (isPlanning(origin)) {
			const denial = planModeFollowUpDenial(
				ports.planMode.isActive(args.agentSessionId),
			);
			if (denial) {
				return fail('denied-scope', denial);
			}
		}
		if (args.wait) {
			const deadlock = guardrails.evaluateWaitTarget(
				args.agentSessionId,
				originRegistry.ancestorsOf(origin.sessionId),
			);
			if (!deadlock.ok) {
				return fail(deadlock.code, deadlock.reason);
			}
		}
		await ports.conversations.sendFollowUp({
			agentSessionId: args.agentSessionId,
			prompt: args.prompt,
		});
		const result = await waitIfRequested(
			args.agentSessionId,
			args.wait,
			signal,
		);
		return ok({ result });
	};

	const handleCloseTab = async (
		origin: AgentControlOrigin,
		args: CloseTabArgs,
	): Promise<AgentControlResult<unknown>> => {
		const owner = await ports.tabs.resolveTabWorkspace(args.chatTabId);
		const scoped = outOfScope(owner, origin);
		if (scoped) {
			return scoped;
		}
		await ports.tabs.closeTab({ chatTabId: args.chatTabId });
		return ok({ ok: true });
	};

	const handleLaunchHarness = async (
		origin: AgentControlOrigin,
		args: LaunchHarnessArgs,
	): Promise<AgentControlResult<unknown>> => {
		const spawnDenied = evaluateSpawnGuard(origin);
		if (spawnDenied) {
			return spawnDenied;
		}
		const launched = await ports.harnesses.launchHarness({
			workspaceId: origin.workspaceId,
			harnessId: args.harnessId,
			parentSessionId: origin.sessionId,
		});
		guardrails.recordSpawn(origin.sessionId);
		return ok(launched);
	};

	const handleStartTerminal = async (
		origin: AgentControlOrigin,
		args: StartTerminalArgs,
	): Promise<AgentControlResult<unknown>> => {
		const spawnDenied = evaluateSpawnGuard(origin);
		if (spawnDenied) {
			return spawnDenied;
		}
		const started = await ports.terminals.startTerminal({
			workspaceId: origin.workspaceId,
			workspaceCwd: origin.workspaceCwd,
			kind: args.kind,
			...(args.scriptName ? { scriptName: args.scriptName } : {}),
			...(args.restart ? { restart: true } : {}),
		});
		if (!started.ok) {
			return fail(
				startTerminalErrorCode(started.code),
				describeStartTerminalRefusal(started.message, started.terminalId),
			);
		}
		guardrails.recordSpawn(origin.sessionId);
		// A terminal an agent started is one the user is meant to watch, so bring it
		// forward rather than leaving it behind whichever dock tab was already open.
		ports.focus.focusDockTab({
			workspaceId: origin.workspaceId,
			dock:
				args.kind === 'spawn' ? `terminal:${started.terminalId}` : args.kind,
		});
		return ok({ terminalId: started.terminalId });
	};

	/**
	 * Reads a terminal's scrollback, by id or by the logical selector the start
	 * and stop ops take. Resolving `kind` here is what keeps a caller that started
	 * a run script from having to list every terminal to read the one it started.
	 *
	 * An id is scope-checked exactly as `stopTerminal` and `writeTerminal` check
	 * theirs: scrollback carries whatever the terminal has been shown, so reading
	 * one belonging to another workspace is the same crossing writing to it would
	 * be. A `kind` selector is already scoped by the lookup it resolves through.
	 * @param origin - Resolved caller identity.
	 * @param args - Which terminal to read, and whether to keep the raw bytes.
	 * @returns The scrollback with the terminal it came from, or `not-found`.
	 */
	const handleReadTerminalOutput = async (
		origin: AgentControlOrigin,
		args: ReadTerminalOutputArgs,
	): Promise<AgentControlResult<unknown>> => {
		if (args.terminalId) {
			const owner = await ports.terminals.resolveTerminalWorkspace(
				args.terminalId,
			);
			const scoped = outOfScope(owner, origin);
			if (scoped) {
				return scoped;
			}
		}
		const terminalId =
			args.terminalId ?? (await resolveScriptTerminal(origin, args.kind));
		if (!terminalId) {
			return fail(
				'not-found',
				`No ${args.kind} script is running in this workspace, so there is no output to read.`,
			);
		}
		return ok({
			terminalId,
			output: await ports.terminals.readOutput({
				terminalId,
				ansi: args.ansi === true,
			}),
		} satisfies ReadTerminalOutputResult);
	};

	/**
	 * Finds the workspace's live setup or run script terminal, which is what a
	 * `kind` selector names. Only one script of a kind runs per workspace, so the
	 * first live match is the only one.
	 * @param origin - Resolved caller identity.
	 * @param kind - Which script terminal to find.
	 * @returns Its terminal id, or null when no such script is running.
	 */
	const resolveScriptTerminal = async (
		origin: AgentControlOrigin,
		kind: 'setup' | 'run' | undefined,
	): Promise<string | null> => {
		if (!kind) {
			return null;
		}
		const terminals = await ports.terminals.listTerminals({
			workspaceId: origin.workspaceId,
		});
		return (
			terminals.find(
				(terminal) =>
					terminal.kind === `${kind}-script` && terminal.status === 'running',
			)?.terminalId ?? null
		);
	};

	const handleStopTerminal = async (
		origin: AgentControlOrigin,
		args: StopTerminalArgs,
	): Promise<AgentControlResult<unknown>> => {
		if (args.terminalId) {
			const owner = await ports.terminals.resolveTerminalWorkspace(
				args.terminalId,
			);
			const scoped = outOfScope(owner, origin);
			if (scoped) {
				return scoped;
			}
		}
		await ports.terminals.stopTerminal({
			workspaceId: origin.workspaceId,
			terminalId: args.terminalId,
			kind: args.kind,
		});
		return ok({ ok: true });
	};

	const handleWriteTerminal = async (
		origin: AgentControlOrigin,
		args: WriteTerminalArgs,
	): Promise<AgentControlResult<unknown>> => {
		const owner = await ports.terminals.resolveTerminalWorkspace(
			args.terminalId,
		);
		const scoped = outOfScope(owner, origin);
		if (scoped) {
			return scoped;
		}
		await ports.terminals.writeTerminal({
			terminalId: args.terminalId,
			input: args.input,
		});
		return ok({ ok: true });
	};

	const handleOpenTab = async (
		origin: AgentControlOrigin,
		args: OpenTabArgs,
	): Promise<AgentControlResult<unknown>> => {
		const spawnDenied = evaluateSpawnGuard(origin);
		if (spawnDenied) {
			return spawnDenied;
		}
		const created = await ports.tabs.openNonChatTab({
			workspaceId: origin.workspaceId,
			variant: args.variant,
			filePath: args.filePath,
			turnId: args.turnId,
			commentBody: args.commentBody,
			prNumber: args.prNumber,
		});
		guardrails.recordSpawn(origin.sessionId);
		return ok(created);
	};

	/**
	 * Brings a chat tab forward, in the workspace that owns it rather than in the
	 * caller's — the two are the same for a workspace agent, and the Concierge has
	 * no workspace of its own to focus into.
	 * @param origin - Resolved caller identity.
	 * @param args - The tab to focus.
	 * @returns Acknowledgement, or a scope failure.
	 */
	const handleFocusTab = async (
		origin: AgentControlOrigin,
		args: FocusTabArgs,
	): Promise<AgentControlResult<unknown>> => {
		const owner = await ports.tabs.resolveTabWorkspace(args.chatTabId);
		const scoped = outOfScope(owner, origin);
		if (scoped) {
			return scoped;
		}
		const target = await resolveTargetWorkspace(origin, undefined, owner);
		if ('failure' in target) {
			return target.failure;
		}
		ports.focus.focusTab({
			workspaceId: target.workspaceId,
			chatTabId: args.chatTabId,
		});
		return ok({ ok: true });
	};

	/**
	 * Brings a dock terminal forward. A `terminalId` names its own workspace, so
	 * only the `kind` selector leaves a Concierge with nothing to focus into —
	 * which is what `workspaceId` supplies.
	 * @param origin - Resolved caller identity.
	 * @param args - The terminal or script kind to focus, and the workspace for a Concierge.
	 * @returns Acknowledgement, or a scope failure.
	 */
	const handleFocusDockTab = async (
		origin: AgentControlOrigin,
		args: FocusDockTabArgs,
	): Promise<AgentControlResult<unknown>> => {
		let owner: string | null = null;
		if (args.terminalId) {
			owner = await ports.terminals.resolveTerminalWorkspace(args.terminalId);
			const scoped = outOfScope(owner, origin);
			if (scoped) {
				return scoped;
			}
		}
		const target = await resolveTargetWorkspace(
			origin,
			args.workspaceId,
			owner,
		);
		if ('failure' in target) {
			return target.failure;
		}
		const dock = args.terminalId
			? `terminal:${args.terminalId}`
			: (args.kind as string);
		ports.focus.focusDockTab({ workspaceId: target.workspaceId, dock });
		return ok({ ok: true });
	};

	/**
	 * Resolves the workspace a listing answers for. Reads are not scope-limited —
	 * an agent may inspect any open workspace — so a named id is honoured whoever
	 * asked. Only the Concierge goes through the acting resolver, because the
	 * workspace it would otherwise default to is the empty string, which the
	 * listing ports answer with an empty array rather than an error.
	 * @param origin - Resolved caller identity.
	 * @param named - The `workspaceId` the op's args carried, if any.
	 * @returns The workspace id to list, or a failure envelope.
	 */
	const resolveListWorkspace = async (
		origin: AgentControlOrigin,
		named: string | undefined,
	): Promise<
		{ workspaceId: string } | { failure: AgentControlResult<never> }
	> =>
		origin.concierge
			? resolveTargetWorkspace(origin, named)
			: { workspaceId: named ?? origin.workspaceId };

	/**
	 * Lists the tabs of the workspace the caller named, or of its own.
	 * @param origin - Resolved caller identity.
	 * @param args - The workspace to list, required of a Concierge.
	 * @returns The tab rows, or a failure envelope.
	 */
	const handleListTabs = async (
		origin: AgentControlOrigin,
		args: ListTabsArgs,
	): Promise<AgentControlResult<unknown>> => {
		const target = await resolveListWorkspace(origin, args.workspaceId);
		if ('failure' in target) {
			return target.failure;
		}
		return ok(await ports.tabs.listTabs({ workspaceId: target.workspaceId }));
	};

	/**
	 * Lists the terminals of the workspace the caller named, or of its own.
	 * @param origin - Resolved caller identity.
	 * @param args - The workspace to list, required of a Concierge.
	 * @returns The terminal rows, or a failure envelope.
	 */
	const handleListTerminals = async (
		origin: AgentControlOrigin,
		args: ListTerminalsArgs,
	): Promise<AgentControlResult<unknown>> => {
		const target = await resolveListWorkspace(origin, args.workspaceId);
		if ('failure' in target) {
			return target.failure;
		}
		return ok(
			await ports.terminals.listTerminals({ workspaceId: target.workspaceId }),
		);
	};

	const handleFocusPanel = async (
		origin: AgentControlOrigin,
		args: FocusPanelArgs,
	): Promise<AgentControlResult<unknown>> => {
		const target = await resolveTargetWorkspace(origin, args.workspaceId);
		if ('failure' in target) {
			return target.failure;
		}
		ports.focus.focusPanel({
			workspaceId: target.workspaceId,
			panel: args.panel,
		});
		return ok({ ok: true });
	};

	/**
	 * Moves the app to a workspace. Concierge-only, because every other caller is
	 * already in the one workspace it can address.
	 * @param origin - Resolved caller identity.
	 * @param args - The workspace to navigate to.
	 * @returns Acknowledgement, or a scope failure.
	 */
	const handleFocusWorkspace = async (
		origin: AgentControlOrigin,
		args: FocusWorkspaceArgs,
	): Promise<AgentControlResult<unknown>> => {
		const target = await resolveTargetWorkspace(origin, args.workspaceId);
		if ('failure' in target) {
			return target.failure;
		}
		ports.focus.focusWorkspace({ workspaceId: target.workspaceId });
		return ok({ ok: true });
	};

	/**
	 * Cuts a new workspace off a project, so the Concierge can start work that has
	 * nowhere to live yet rather than asking the user to make the worktree by hand,
	 * and moves the app to it.
	 *
	 * The route follows the worktree because a workspace nobody is looking at is
	 * indistinguishable from one that was never made: the sidebar only refreshes
	 * its tree on a poll, so without the focus the user watches the Concierge
	 * report a workspace that is not on screen anywhere. It is the same op
	 * `ensemblr_focus_workspace` runs, which already handles a workspace this
	 * window has never opened.
	 * @param origin - Resolved caller identity.
	 * @param args - Project to fork, the name the workspace and its branch are
	 * cut with, and the optional base branch.
	 * @returns The created workspace, or a failure envelope.
	 */
	const handleCreateWorkspace = async (
		origin: AgentControlOrigin,
		args: CreateWorkspaceArgs,
	): Promise<AgentControlResult<unknown>> => {
		if (!origin.concierge) {
			return fail(
				'denied-scope',
				'Creating a workspace belongs to the Concierge, which works across every project. Ask the user to create one, or say in your report which project it should come off.',
			);
		}
		const port = ports.workspaceCreation;
		if (!port) {
			return fail('internal', 'Workspace creation is unavailable.');
		}
		const created = await port.createWorkspace({
			...(args.baseBranch ? { baseBranch: args.baseBranch } : {}),
			name: args.name,
			projectId: args.projectId,
		});
		ports.focus.focusWorkspace({ workspaceId: created.workspaceId });
		return ok(created);
	};

	/**
	 * Lists every project the app has opened. Concierge-only: a workspace agent
	 * belongs to one project and cannot act on another, while the Concierge needs
	 * the roster to reach a project no live workspace names — which is the only
	 * place `ensemblr_create_workspace` can get its `projectId` from.
	 * @param origin - Resolved caller identity.
	 * @returns The project listing, or a scope failure.
	 */
	const handleListProjects = async (
		origin: AgentControlOrigin,
	): Promise<AgentControlResult<unknown>> => {
		if (!origin.concierge) {
			return fail(
				'denied-scope',
				'The project roster belongs to the Concierge, which works across every project. You are in one workspace and can act only there.',
			);
		}
		return ok({ projects: await ports.workspaces.listProjects() });
	};

	/**
	 * Searches the Concierge's own memory index.
	 * @param origin - Resolved caller identity.
	 * @param args - The search text and result cap.
	 * @returns The ranked memories, or a scope failure.
	 */
	const handleRecallMemory = (
		origin: AgentControlOrigin,
		args: RecallMemoryArgs,
	): AgentControlResult<unknown> => {
		if (!origin.concierge || !ports.memory) {
			return fail(
				'denied-scope',
				'The memory index belongs to the Concierge. Nothing else has one to search.',
			);
		}
		return ok(
			ports.memory.recall({
				...(args.limit === undefined ? {} : { limit: args.limit }),
				query: args.query,
			}),
		);
	};

	const handleSetWorkspaceStatus = async (
		origin: AgentControlOrigin,
		args: SetWorkspaceStatusArgs,
	): Promise<AgentControlResult<unknown>> => {
		const target = await resolveTargetWorkspace(origin, args.workspaceId);
		if ('failure' in target) {
			return target.failure;
		}
		ports.board.setWorkspaceStatus({
			workspaceId: target.workspaceId,
			status: args.status,
		});
		return ok({ ok: true });
	};

	const handleGetWorkspaceStatus = async (
		origin: AgentControlOrigin,
		args: GetWorkspaceStatusArgs,
	): Promise<AgentControlResult<unknown>> => {
		const target = await resolveTargetWorkspace(origin, args.workspaceId);
		if ('failure' in target) {
			return target.failure;
		}
		return ok({ status: ports.board.getWorkspaceStatus(target.workspaceId) });
	};

	/**
	 * Files a Linear issue, behind a search-for-duplicates precondition.
	 *
	 * The precondition is enforced rather than asked for. Every other guard on
	 * this op is about the ticket's shape — the right team, a state an unread
	 * ticket belongs in — and none of them can tell that the issue already exists
	 * under someone else's wording. Only a search can, and "search first" left to
	 * the prompt is the instruction a model skips exactly when a backlog is large
	 * enough for the duplicate to be likely. One search per session clears it: the
	 * point is that the agent has looked, not that it looks once per filing.
	 * @param origin - Resolved caller identity.
	 * @param args - The issue to file.
	 * @returns The filed issue, or the reason it was refused.
	 */
	const handleLinearCreateIssue = async (
		origin: AgentControlOrigin,
		args: LinearCreateIssueArgs,
	): Promise<AgentControlResult<unknown>> => {
		if (!linearSearchesBySession.has(origin.sessionId)) {
			return fail(
				'denied-scope',
				'Search Linear before filing: call `ensemblr_linear_list_issues` with a query describing this problem, and file only if nothing there already covers it. A duplicate cannot be deleted from here, and the team reads both. One search in this conversation is enough — this is refused only because none has happened yet.',
			);
		}
		return ports.linear
			.createIssue({ ...args, workspaceId: origin.workspaceId })
			.then(ok);
	};

	/**
	 * Resolves who a message to the Concierge is from, off the caller's own
	 * control token rather than anything it passed.
	 *
	 * Both lookups degrade to null rather than failing the send: a workspace the
	 * listing cannot name and a session with no tab are cosmetic losses in the
	 * header, and refusing the message over either would drop the one channel a
	 * blocked agent has.
	 * @param origin - Resolved caller identity.
	 * @returns The sender as the Concierge will read it.
	 */
	const resolveMessageSender = async (
		origin: AgentControlOrigin,
	): Promise<ConciergeMessageSender> => {
		const [workspaces, tabs] = await Promise.all([
			ports.workspaces.listWorkspaces().catch(() => []),
			ports.tabs.listTabs({ workspaceId: origin.workspaceId }).catch(() => []),
		]);
		const workspace = workspaces.find(
			(row) => row.workspaceId === origin.workspaceId,
		);
		const tab = tabs.find((row) => row.agentSessionId === origin.sessionId);
		return {
			agentSessionId: origin.sessionId,
			tabTitle: tab?.title ?? null,
			workspaceId: origin.workspaceId,
			workspaceName: workspace?.name ?? null,
		};
	};

	/**
	 * Delivers a workspace agent's message to the live Concierge conversation.
	 *
	 * Nothing here takes a session id, and that is the feature: the Concierge is
	 * cleared and restarted routinely, so the only id that is ever right is the one
	 * resolved at this moment. An absent conversation is refused rather than
	 * opened — a message that booted the Concierge would start a turn nobody is
	 * watching — and the refusal names what to do instead, because the failure this
	 * op exists to prevent is a discovery that never reaches anybody.
	 * @param origin - Resolved caller identity.
	 * @param args - The reason and the agent's own prose.
	 * @returns Which conversation took the message, or why none did.
	 */
	const handleMessageConcierge = async (
		origin: AgentControlOrigin,
		args: MessageConciergeArgs,
	): Promise<AgentControlResult<unknown>> => {
		const concierge = ports.concierge;
		if (!concierge) {
			return fail(
				'not-found',
				'This build has no Concierge, so there is nothing above you to message. Say it in your last message instead.',
			);
		}
		const budget = guardrails.evaluateConciergeMessage(origin.sessionId);
		if (!budget.ok) {
			return fail(budget.code, budget.reason);
		}
		const delivery = await concierge.deliverMessage({
			prompt: buildConciergeMessage({
				message: args.message,
				reason: args.reason,
				sender: await resolveMessageSender(origin),
			}),
		});
		if (!delivery.delivered) {
			return fail(
				delivery.cause === 'no-session' ? 'not-found' : 'internal',
				delivery.cause === 'no-session'
					? 'No Concierge conversation is open, so there is nobody up there to read this. It is not queued — a message delivered hours later, into a conversation that has since been cleared, is worse than none. Put what you were going to say in your last message, which is what the Concierge reads when it next looks at this workspace.'
					: `The Concierge conversation refused the message: ${delivery.detail} Say it in your last message instead rather than retrying in a loop.`,
			);
		}
		guardrails.recordConciergeMessage(origin.sessionId);
		return ok({
			conciergeSessionId: delivery.conciergeSessionId,
			message:
				'Delivered to the Concierge conversation that is live right now. It arrives as a turn the user can see, marked as coming from an agent rather than from them. Carry on with your work — nothing here waits for a reply, and a reply, if one comes, arrives as a follow-up in this conversation.',
		} satisfies MessageConciergeResult);
	};

	/**
	 * Parks a child's signal for the orchestrator's next wait tick. Gated on the
	 * durable role rather than on live lineage: `origin.parentSessionId` lives in
	 * the in-memory registry, so a session resumed after a restart would lose its
	 * one sanctioned escape hatch at exactly the moment the depth counter stopped
	 * denying it everything else. The signal is keyed by child, and a wait reads it
	 * by child id, so recovering the parent's id is not needed to deliver it.
	 *
	 * Delivery still needs the orchestrator to name the child. A default wait
	 * resolves its targets from the same in-memory lineage, so after a restart it
	 * finds none — {@link emptyWait} is what tells the orchestrator to pass the ids
	 * explicitly rather than read the empty result as "nothing needs me".
	 * @param origin - Resolved caller identity.
	 * @param args - The signal reason and its message.
	 * @returns An acknowledgement, or a `not-found` failure for a root caller.
	 */
	const handleNotifyOrchestrator = async (
		origin: AgentControlOrigin,
		args: NotifyOrchestratorArgs,
	): Promise<AgentControlResult<unknown>> => {
		if ((await resolveRole(origin)) !== 'subagent') {
			return fail(
				'not-found',
				'No orchestrator to notify: this session was not spawned by another agent.',
			);
		}
		signalsByChild.set(origin.sessionId, {
			reason: args.reason,
			message: args.message,
		});
		return ok({ ok: true });
	};

	/**
	 * Reads one target's live settle state for a poll tick. Deliberately cheap:
	 * status plus any pending signal, never the child's report, because this runs
	 * for every target on every tick and reading a report means a synchronous
	 * descending scan of its whole final turn on the main thread. The report is
	 * fetched once, by {@link reportOn}, on the tick that returns.
	 * @param agentSessionId - The child to inspect.
	 * @returns The child's current state and whether it counts as settled.
	 */
	const settleTarget = async (
		agentSessionId: string,
	): Promise<{ agent: WaitedAgent; settled: boolean }> => {
		const status = (await ports.conversations.getStatus(agentSessionId))
			?.status;
		const signal = signalsByChild.get(agentSessionId) ?? null;
		const terminal = status === undefined || TERMINAL_STATUSES.has(status);
		return {
			agent: {
				agentSessionId,
				status: status ?? 'unknown',
				lastMessage: null,
				reportTruncated: false,
				signal,
			},
			settled: terminal || needsAttention(signal),
		};
	};

	/**
	 * Attaches one settled child's report at the caller's requested detail. `full`
	 * hands the whole final turn over; `brief` keeps its opening and points at
	 * `getLastMessage` for the rest.
	 * @param agent - The settled child as `settleTarget` built it, with no report yet.
	 * @param detail - The detail level the caller asked for.
	 * @returns The child to report on, shortened when asked for.
	 */
	const reportOn = async (
		agent: WaitedAgent,
		detail: WaitReportDetail,
	): Promise<WaitedAgent> => {
		const lastMessage = await ports.conversations.getLastMessage(
			agent.agentSessionId,
		);
		if (detail === 'full') {
			return { ...agent, lastMessage };
		}
		const brief = briefReport(lastMessage, agent.agentSessionId);
		return {
			...agent,
			lastMessage: brief.text,
			reportTruncated: brief.truncated,
		};
	};

	/**
	 * Reports on the children that finished and consumes the escalations they
	 * carried, because handing a signal to a caller is what spends it.
	 * @param done - The settled targets from the tick that returned.
	 * @param detail - The report detail the caller asked for.
	 * @returns Each finished child with its report attached.
	 */
	const collectReports = async (
		done: readonly { agent: WaitedAgent }[],
		detail: WaitReportDetail,
	): Promise<WaitedAgent[]> => {
		const completed = await Promise.all(
			done.map((entry) => reportOn(entry.agent, detail)),
		);
		for (const entry of completed) {
			signalsByChild.delete(entry.agentSessionId);
		}
		return completed;
	};

	/**
	 * Polls the targets until the mode is satisfied, the deadline passes, or the
	 * waiting turn ends. An abandoned wait returns before it reports: the report
	 * is expensive and it spends the children's escalations, so a turn that is
	 * already gone must not be the one to take them.
	 * @param input - The targets to poll, the caller's mode and report detail, the
	 *   deadline, and the signal that ends the wait early.
	 * @returns What settled, what is still running, and whether time ran out.
	 */
	const pollUntilSettled = async (input: {
		targets: readonly string[];
		mode: WaitMode;
		detail: WaitReportDetail;
		deadline: number;
		signal: AbortSignal | undefined;
	}): Promise<WaitForAgentsResult> => {
		const { deadline, detail, mode, signal, targets } = input;
		for (;;) {
			const settled = await Promise.all(targets.map(settleTarget));
			const pending = stillRunning(settled);
			if (signal?.aborted) {
				return waitOutcome({ completed: [], mode, pending, timedOut: false });
			}
			const done = settled.filter((entry) => entry.settled);
			const satisfied =
				mode === 'first' ? done.length > 0 : waitAllSatisfied(settled);
			const expired = scheduler.now() >= deadline;
			if (satisfied || expired) {
				return waitOutcome({
					completed: await collectReports(done, detail),
					mode,
					pending,
					timedOut: !satisfied && expired,
				});
			}
			await scheduler.sleep(WAIT_POLL_MS);
		}
	};

	/**
	 * Blocks the caller until its children settle or its deadline passes, then
	 * reports on whichever of them finished. A turn that ends mid-wait bails out
	 * without a report, since there is no longer anyone to read one.
	 * @param origin - Resolved caller identity, whose children are the default
	 *   targets.
	 * @param args - Validated targets, mode, report detail, and timeout.
	 * @param signal - Aborts when the waiting turn ends, so the poll loop stops
	 *   rather than running its full window for nobody.
	 * @returns The wait outcome, or a guardrail denial for a deadlocking target.
	 */
	const handleWaitForAgents = async (
		origin: AgentControlOrigin,
		args: WaitForAgentsArgs,
		signal: AbortSignal | undefined,
	): Promise<AgentControlResult<unknown>> => {
		const targets = args.targets ?? [
			...originRegistry.childrenOf(origin.sessionId),
		];
		if (targets.length === 0) {
			return ok(emptyWait(args.targets === undefined));
		}
		const ancestors = originRegistry.ancestorsOf(origin.sessionId);
		for (const target of targets) {
			const deadlock = guardrails.evaluateWaitTarget(target, ancestors);
			if (!deadlock.ok) {
				return fail(deadlock.code, deadlock.reason);
			}
		}
		const timeoutMs = Math.min(
			args.timeoutMs ?? guardrails.waitTimeoutMs,
			guardrails.waitTimeoutMs,
		);
		return ok(
			await pollUntilSettled({
				deadline: scheduler.now() + timeoutMs,
				detail: args.reports ?? 'full',
				mode: args.mode ?? 'first',
				signal,
				targets,
			}),
		);
	};

	/**
	 * Puts a questionnaire to the human. Restricted to callers with a chat tab:
	 * the dialog is rendered inside the tab bound to the asking session, and a
	 * harness has no such tab to host it.
	 * @param origin - Resolved caller identity.
	 * @param args - The validated questionnaire.
	 * @param signal - Aborts when the asking turn ends, withdrawing the dialog.
	 * @returns The user's answers, or a scope failure for a caller with no tab.
	 */
	const handleAskUserQuestion = async (
		origin: AgentControlOrigin,
		args: AskUserQuestionArgs,
		signal: AbortSignal | undefined,
	): Promise<AgentControlResult<unknown>> => {
		if (!originHasChatTab(origin)) {
			return fail(
				'denied-scope',
				'Asking the user is limited to native chat conversations.',
			);
		}
		return ok(
			await ports.ask.ask({ origin, questions: args.questions, signal }),
		);
	};

	/**
	 * Classifies an intercepted tool call against Plan Mode policy. A session
	 * that is not planning allows everything, so the extension can ask without
	 * first knowing whether the toggle is still on.
	 * @param origin - Resolved caller identity.
	 * @param args - The tool name and, for `bash`, its command.
	 * @returns Whether the call is blocked, with the reason when it is.
	 */
	const handleCheckPlanModeTool = (
		origin: AgentControlOrigin,
		args: CheckPlanModeToolArgs,
	): AgentControlResult<unknown> => {
		// The Concierge's policy is permanent rather than a mode it can leave, and
		// it is stricter than Plan Mode on writes and identical on bash, so it
		// answers alone rather than being layered under a planning check that would
		// never be true for a Concierge anyway.
		if (origin.concierge) {
			const conciergeHome = ports.concierge?.homePath();
			return ok(
				conciergeHome
					? evaluateConciergeTool({ ...args, conciergeHome })
					: { blocked: true, reason: 'The Concierge home is unavailable.' },
			);
		}
		if (!isPlanning(origin)) {
			return ok({ blocked: false });
		}
		return ok(evaluatePlanModeTool(args));
	};

	/**
	 * Puts a finished plan to the human for review. Restricted to callers with a
	 * chat tab that are actually planning: the review panel is rendered inside the
	 * tab bound to the planning session, and without the second check any agent
	 * could drop a file in `.context/plans/` and put a decision panel — whose
	 * Approve button submits a prompt — in front of the user unprompted.
	 *
	 * Deliberately classified as a read for the permission gate (see `WRITE_OPS`):
	 * it is the only way out of Plan Mode, so blocking it under a restrictive mode
	 * would strand the agent with every editing tool denied and no exit.
	 * @param origin - Resolved caller identity.
	 * @param args - The plan title and markdown body.
	 * @returns The submission result, or a scope failure for ineligible callers.
	 */
	const handleExitPlanMode = async (
		origin: AgentControlOrigin,
		args: ExitPlanModeArgs,
	): Promise<AgentControlResult<unknown>> => {
		if (!originHasChatTab(origin)) {
			return fail(
				'denied-scope',
				'Plan Mode is limited to native chat conversations.',
			);
		}
		if (!ports.planMode.isActive(origin.sessionId)) {
			return fail(
				'denied-scope',
				'This conversation is not in Plan Mode, so there is no plan to submit. Implement the work directly.',
			);
		}
		return ok(await ports.planMode.exit({ args, origin }));
	};

	const readConversationStatus = async (
		agentSessionId: string,
	): Promise<AgentControlResult<unknown>> => {
		const status = await ports.conversations.getStatus(agentSessionId);
		if (!status) {
			return ok(null);
		}
		return ok({
			...status,
			hasFinalMessage:
				await ports.conversations.hasFinalMessage(agentSessionId),
		} satisfies AgentControlConversationStatus);
	};

	/**
	 * Reads the diff of the workspace the caller named, or of its own.
	 * @param origin - Resolved caller identity.
	 * @param args - File filter or stat flag, and the workspace for a Concierge.
	 * @returns The diff payload, or a failure envelope.
	 */
	const handleGetWorkspaceDiff = async (
		origin: AgentControlOrigin,
		args: GetWorkspaceDiffArgs,
	): Promise<AgentControlResult<unknown>> => {
		const target = await resolveTargetWorkspace(origin, args.workspaceId);
		if ('failure' in target) {
			return target.failure;
		}
		return ok(
			await ports.diff.readWorkspaceDiff({
				file: args.filePath,
				stat: args.stat,
				workspaceCwd: target.cwd,
				workspaceId: target.workspaceId,
			}),
		);
	};

	/**
	 * Lists the review comments on the workspace the caller named, or on its own.
	 * @param origin - Resolved caller identity.
	 * @param args - Optional file filter, and the workspace for a Concierge.
	 * @returns The comments, or a failure envelope.
	 */
	const handleGetDiffComments = async (
		origin: AgentControlOrigin,
		args: GetDiffCommentsArgs,
	): Promise<AgentControlResult<unknown>> => {
		const target = await resolveTargetWorkspace(origin, args.workspaceId);
		if ('failure' in target) {
			return target.failure;
		}
		return ok(
			await ports.review.listComments({
				file: args.filePath,
				workspaceId: target.workspaceId,
			}),
		);
	};

	/**
	 * Files the batch, then puts the user in front of it: the comment roll-up
	 * lives in Checks, so a pass that leaves six findings lands them on the list
	 * rather than in the file-by-file diff they would have to scroll to collect.
	 * @param origin - Resolved caller identity.
	 * @param args - The comments to file, and the workspace for a Concierge.
	 * @returns How many were saved, and their new ids, or a failure envelope.
	 */
	const handleAddDiffComments = async (
		origin: AgentControlOrigin,
		args: AddDiffCommentsArgs,
	): Promise<AgentControlResult<unknown>> => {
		const target = await resolveTargetWorkspace(origin, args.workspaceId);
		if ('failure' in target) {
			return target.failure;
		}
		const result = await ports.review.addComments({
			comments: args.comments,
			workspaceId: target.workspaceId,
		});
		reviewFocus.focusChecks(target.workspaceId);
		return ok(result);
	};

	/**
	 * Resolving nothing pulls no focus: every id was already closed or matched no
	 * open comment, so there is nothing new for the user to look at and moving
	 * them would be a yank with no payload behind it. Same condition the port
	 * broadcasts its cache invalidation on.
	 * @param origin - Resolved caller identity.
	 * @param args - The comment ids to close, and the workspace for a Concierge.
	 * @returns The batch partitioned into resolved, already-resolved, and unknown.
	 */
	const handleResolveDiffComments = async (
		origin: AgentControlOrigin,
		args: ResolveDiffCommentsArgs,
	): Promise<AgentControlResult<unknown>> => {
		const target = await resolveTargetWorkspace(origin, args.workspaceId);
		if ('failure' in target) {
			return target.failure;
		}
		const result = await ports.review.resolveComments({
			commentIds: args.commentIds,
			workspaceId: target.workspaceId,
		});
		if (result.resolved > 0) {
			reviewFocus.focusChecks(target.workspaceId);
		}
		return ok(result);
	};

	// Every review op now takes an optional `workspaceId`, which only the
	// Concierge may fill: `resolveTargetWorkspace` refuses a workspace agent that
	// names another workspace, so the cross-workspace path is the supervisor's
	// alone. The Linear ops take no workspace at all — the integration is bound to
	// one account app-wide.
	const opHandlers: Record<AgentControlOp, OpHandler> = {
		addDiffComments: ({ args, origin }) =>
			handleAddDiffComments(origin, args as AddDiffCommentsArgs),
		askUserQuestion: ({ args, origin, signal }) =>
			handleAskUserQuestion(origin, args as AskUserQuestionArgs, signal),
		checkPlanModeTool: ({ args, origin }) =>
			handleCheckPlanModeTool(origin, args as CheckPlanModeToolArgs),
		closeTab: ({ args, origin }) =>
			handleCloseTab(origin, args as CloseTabArgs),
		exitPlanMode: ({ args, origin }) =>
			handleExitPlanMode(origin, args as ExitPlanModeArgs),
		focusDockTab: ({ args, origin }) =>
			handleFocusDockTab(origin, args as FocusDockTabArgs),
		focusPanel: ({ args, origin }) =>
			handleFocusPanel(origin, args as FocusPanelArgs),
		focusTab: ({ args, origin }) =>
			handleFocusTab(origin, args as FocusTabArgs),
		getConversationStatus: ({ args }) =>
			readConversationStatus((args as ConversationRef).agentSessionId),
		getDiffComments: ({ args, origin }) =>
			handleGetDiffComments(origin, args as GetDiffCommentsArgs),
		getLastMessage: async ({ args }) =>
			ok({
				message: await ports.conversations.getLastMessage(
					(args as ConversationRef).agentSessionId,
				),
			} satisfies GetLastMessageResult),
		getSessionBrief: ({ origin }) => handleGetSessionBrief(origin),
		getWorkspaceDiff: ({ args, origin }) =>
			handleGetWorkspaceDiff(origin, args as GetWorkspaceDiffArgs),
		focusWorkspace: ({ args, origin }) =>
			handleFocusWorkspace(origin, args as FocusWorkspaceArgs),
		createWorkspace: ({ args, origin }) =>
			handleCreateWorkspace(origin, args as CreateWorkspaceArgs),
		recallMemory: ({ args, origin }) =>
			handleRecallMemory(origin, args as RecallMemoryArgs),
		getWorkspaceStatus: ({ args, origin }) =>
			handleGetWorkspaceStatus(origin, args as GetWorkspaceStatusArgs),
		launchHarness: ({ args, origin }) =>
			handleLaunchHarness(origin, args as LaunchHarnessArgs),
		linearCreateComment: ({ args, origin }) =>
			ports.linear
				.createComment({
					...(args as LinearCreateCommentArgs),
					workspaceId: origin.workspaceId,
				})
				.then(ok),
		linearGetIssue: ({ args, origin }) =>
			ports.linear
				.getIssue({
					...(args as LinearGetIssueArgs),
					workspaceId: origin.workspaceId,
				})
				.then(ok),
		linearGetMetadata: ({ args, origin }) =>
			ports.linear
				.getMetadata({
					...(args as LinearGetMetadataArgs),
					workspaceId: origin.workspaceId,
				})
				.then(ok),
		linearCreateIssue: ({ args, origin }) =>
			handleLinearCreateIssue(origin, args as LinearCreateIssueArgs),
		// Recorded on the answer rather than on the attempt: a search that came
		// back `not-connected` never read the backlog, so counting it would let
		// the duplicate guard be cleared by a call that looked at nothing.
		linearListIssues: ({ args, origin }) =>
			ports.linear
				.listIssues({
					...(args as LinearListIssuesArgs),
					workspaceId: origin.workspaceId,
				})
				.then((result) => {
					if (result.status === 'ok') {
						linearSearchesBySession.add(origin.sessionId);
					}
					return ok(result);
				}),
		linearUpdateIssue: ({ args, origin }) =>
			ports.linear
				.updateIssue({
					...(args as LinearUpdateIssueArgs),
					workspaceId: origin.workspaceId,
				})
				.then(ok),
		listModels: ({ origin }) =>
			ports.conversations
				.listModels({ runtime: originRuntime(origin) })
				.then(ok),
		listRunScripts: ({ origin }) =>
			ports.terminals
				.listRunScripts({ workspaceId: origin.workspaceId })
				.then(ok),
		listTabs: ({ args, origin }) =>
			handleListTabs(origin, args as ListTabsArgs),
		listTerminals: ({ args, origin }) =>
			handleListTerminals(origin, args as ListTerminalsArgs),
		listProjects: ({ origin }) => handleListProjects(origin),
		listWorkspaces: () => ports.workspaces.listWorkspaces().then(ok),
		messageConcierge: ({ args, origin }) =>
			handleMessageConcierge(origin, args as MessageConciergeArgs),
		notifyOrchestrator: ({ args, origin }) =>
			handleNotifyOrchestrator(origin, args as NotifyOrchestratorArgs),
		openTab: ({ args, origin }) => handleOpenTab(origin, args as OpenTabArgs),
		readConversation: ({ args }) =>
			ports.conversations.readTranscript(args as ReadConversationArgs).then(ok),
		readTerminalOutput: ({ args, origin }) =>
			handleReadTerminalOutput(origin, args as ReadTerminalOutputArgs),
		resolveDiffComments: ({ args, origin }) =>
			handleResolveDiffComments(origin, args as ResolveDiffCommentsArgs),
		sendFollowUp: ({ args, origin, signal }) =>
			handleSendFollowUp(origin, args as SendFollowUpArgs, signal),
		setBranchName: ({ args, origin }) =>
			handleSetBranchName(origin, args as SetBranchNameArgs),
		setName: ({ args, origin }) => handleSetName(origin, args as SetNameArgs),
		setSummary: ({ args, origin }) =>
			handleSetSummary(origin, args as SetSummaryArgs),
		setWorkspaceStatus: ({ args, origin }) =>
			handleSetWorkspaceStatus(origin, args as SetWorkspaceStatusArgs),
		getArchitectureDiagram: ({ origin }) =>
			handleGetArchitectureDiagram(origin),
		updateArchitectureDiagram: ({ args, origin }) =>
			handleUpdateArchitectureDiagram(
				origin,
				args as UpdateArchitectureDiagramArgs,
			),
		spawnChatTab: ({ args, origin }) =>
			handleSpawnChatTab(origin, args as SpawnChatTabArgs),
		startConversation: ({ args, callerModel, origin, signal }) =>
			handleStartConversation(
				origin,
				args as StartConversationArgs,
				callerModel,
				signal,
			),
		startReview: ({ args, callerModel, origin }) =>
			handleStartReview(origin, args as StartReviewArgs, callerModel),
		startTerminal: ({ args, origin }) =>
			handleStartTerminal(origin, args as StartTerminalArgs),
		stopTerminal: ({ args, origin }) =>
			handleStopTerminal(origin, args as StopTerminalArgs),
		waitForAgents: ({ args, origin, signal }) =>
			handleWaitForAgents(origin, args as WaitForAgentsArgs, signal),
		writeTerminal: ({ args, origin }) =>
			handleWriteTerminal(origin, args as WriteTerminalArgs),
	};

	const dispatch = async (
		op: AgentControlOp,
		origin: AgentControlOrigin,
		args: unknown,
		callerModel: string | undefined,
		signal: AbortSignal | undefined,
	): Promise<AgentControlResult<unknown>> => {
		const handler = opHandlers[op];
		if (!handler) {
			return fail('invalid-args', `Unsupported operation: ${String(op)}.`);
		}
		return await handler({ args, callerModel, origin, signal });
	};

	const invoke = async (
		command: AgentControlCommand,
	): Promise<AgentControlResult<unknown>> => {
		const origin = originRegistry.resolveByToken(command.token);
		if (!origin) {
			return fail('denied-permission', 'Unknown or expired control token.');
		}
		const validated = validateArgs(command.op, command.rawArgs);
		if (!validated.ok) {
			return fail('invalid-args', validated.reason);
		}
		const roleDenied = await gateSubAgentRole(command.op, origin);
		if (roleDenied) {
			return roleDenied;
		}
		const planModeDenied = await gatePlanMode(command.op, origin);
		if (planModeDenied) {
			return planModeDenied;
		}
		const afkDenied = gateAfkMode(command.op, origin);
		if (afkDenied) {
			return afkDenied;
		}
		const permissionDenied = await gatePermission(
			command.op,
			origin,
			command.signal,
		);
		if (permissionDenied) {
			return permissionDenied;
		}
		try {
			return await withDispatchDeadline(
				command.op,
				() =>
					dispatch(
						command.op,
						origin,
						validated.value,
						command.callerModel,
						command.signal,
					),
				dispatchTimeoutMs,
			);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			return fail('internal', `Control op failed: ${detail}`);
		}
	};

	const describeAudience = async (token: string): Promise<ControlAudience> => {
		const architectureDiagram = readArchitectureDiagramEnabled();
		const origin = originRegistry.resolveByToken(token);
		if (!origin) {
			return {
				architectureDiagram,
				delegation: 'ensemblr',
				hasChatTab: false,
				role: 'orchestrator',
			};
		}
		return {
			architectureDiagram,
			delegation: origin.delegation,
			hasChatTab: originHasChatTab(origin),
			role: await resolveRole(origin),
		};
	};

	const readTurnPreamble = async (
		sessionId: string,
	): Promise<string | null> => {
		const origin = originRegistry.resolveBySession(sessionId);
		if (!origin) {
			return null;
		}
		const role = await resolveRole(origin);
		const blocks = [
			buildSessionBriefNudge(
				await ports.sessionNaming.readBrief(origin),
				isPlanning(origin),
			),
			planDelegationFor(origin, role),
			readPlanRefinement(origin),
			buildAfkDirective(isUnattended(origin)),
			buildAfkWorkflowDirective({
				delegation: origin.delegation,
				role,
				unattended: isUnattended(origin),
			}),
			readLanguageDirective(),
			issueDirectiveFor(origin, role),
			readCoAuthorDirective(),
		].filter((block) => block !== null);
		return blocks.length > 0 ? blocks.join('\n\n') : null;
	};

	const readIssueDirective = async (token: string): Promise<string | null> => {
		const origin = originRegistry.resolveByToken(token);
		return origin ? readIssueDirectiveForOrigin(origin) : null;
	};

	const releaseSession = (sessionId: string): void => {
		ports.ask.releaseSession(sessionId);
		ports.planMode.releaseSession(sessionId);
		ports.afkMode.releaseSession(sessionId);
		signalsByChild.delete(sessionId);
		linearSearchesBySession.delete(sessionId);
		reviewsByCaller.delete(sessionId);
		openedReviewSessions.delete(sessionId);
		guardrails.release(sessionId);
		originRegistry.release(sessionId);
	};

	const retireSession = (sessionId: string): void => {
		// The pass may open a questionnaire before the retire lands, and that
		// dialog is exactly what no longer has anywhere to render.
		ports.ask.releaseSession(sessionId);
		originRegistry.retire(sessionId);
	};

	return {
		describeAudience,
		invoke,
		readCoAuthorDirective,
		readIssueDirective,
		readLanguageDirective,
		readTurnPreamble,
		releaseSession,
		retireSession,
	};
}
