/**
 * The agent → app control service. One trusted, main-process entry point that
 * both bridges (the Pi extension and the harness MCP server) funnel into. Every
 * call is validated, its origin resolved from an injected token, permission- and
 * scope-checked, guardrailed, then delegated to an existing service via a port.
 */
import type {
	AddDiffCommentsArgs,
	AgentControlConversationStatus,
	AgentControlErrorCode,
	AgentControlOp,
	AgentControlResult,
	AgentControlRole,
	AskUserQuestionArgs,
	CheckPlanModeToolArgs,
	CloseTabArgs,
	ControlAudience,
	ConversationRef,
	ExitPlanModeArgs,
	FocusDockTabArgs,
	FocusPanelArgs,
	FocusTabArgs,
	GetDiffCommentsArgs,
	GetLastMessageResult,
	GetSessionBriefResult,
	GetWorkspaceDiffArgs,
	LaunchHarnessArgs,
	ListTabsArgs,
	ListTerminalsArgs,
	NotifyOrchestratorArgs,
	OpenTabArgs,
	OrchestratorSignal,
	PendingAgent,
	ReadConversationArgs,
	ReadTerminalOutputArgs,
	ResolveDiffCommentsArgs,
	SendFollowUpArgs,
	SetBranchNameArgs,
	SetNameArgs,
	SetNameResult,
	SetSummaryArgs,
	SetWorkspaceStatusArgs,
	SpawnChatTabArgs,
	StartConversationArgs,
	StartTerminalArgs,
	StopTerminalArgs,
	WaitedAgent,
	WaitForAgentsArgs,
	WaitForAgentsResult,
	WaitMode,
	WaitReportDetail,
	WriteTerminalArgs,
} from '../../shared/agent-control.ts';
import {
	briefReport,
	buildSessionBriefNudge,
	isWriteOp,
	resolveAgentRole,
	subAgentControlOpDenial,
	validateArgs,
} from '../../shared/agent-control.ts';
import { classifyPermissionAction } from '../../shared/permissions.ts';
import {
	evaluatePlanModeTool,
	planModeControlOpDenial,
	planModeFollowUpDenial,
} from '../../shared/plan-mode.ts';
import { BranchSlugRejected } from '../agent-runtime/naming/apply-branch-slug.ts';
import type { Guardrails } from './guardrails.ts';
import type { OriginRegistry } from './origin-registry.ts';
import {
	type AgentControlOrigin,
	type AgentControlPorts,
	originHasChatTab,
} from './ports.ts';

/** A single inbound control command, as handed over by either bridge. */
export interface AgentControlCommand {
	op: AgentControlOp;
	/** Secret token minted at spawn; resolves to the trusted origin. */
	token: string;
	/** Raw, untrusted argument object from the agent. */
	rawArgs: unknown;
	/**
	 * The calling Pi agent's own model, forwarded by the Pi extension as a
	 * fallback for spawned conversations. Absent for harness (MCP) callers.
	 */
	callerModel?: string;
	/**
	 * Aborts when the caller goes away mid-call, so an op that blocks on a human
	 * or a child can stop instead of finishing for nobody. Optional: the MCP
	 * bridge omits it, as does any caller that cannot be cancelled.
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
	 * Renders the per-turn upkeep block for a session the app drives itself.
	 *
	 * Pi pulls the same block over `getSessionBrief` from its own extension, but a
	 * runtime whose only channel is MCP has no per-turn hook to pull it from — its
	 * playbook is appended once, at session open. Without this the branch bullet
	 * never reaches it and the branch is never named.
	 * @param sessionId - The agent session the block describes.
	 * @returns The block to prepend to the turn, or null when nothing is outstanding.
	 */
	readSessionBriefNudge: (sessionId: string) => Promise<string | null>;
	/**
	 * Releases all per-session state (pending orchestrator signal, spawn
	 * counters, origin token) when an agent session ends, keeping the in-memory
	 * maps bounded. Idempotent; safe to call for unknown sessions.
	 */
	releaseSession: (sessionId: string) => void;
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
	/** Overrides the wait-loop clock/sleep; defaults to the real scheduler. */
	scheduler?: WaitScheduler;
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
 * Confirms a resolved workspace matches the caller's, for write-scope checks.
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
	if (actualWorkspaceId !== origin.workspaceId) {
		return fail(
			'denied-scope',
			'Writes are limited to the agent’s own workspace.',
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
	scheduler = REAL_SCHEDULER,
}: AgentControlServiceOptions): AgentControlService {
	/** Latest pending signal per child session id, set by `notifyOrchestrator`. */
	const signalsByChild = new Map<string, OrchestratorSignal>();

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
	): Promise<AgentControlRole> =>
		resolveAgentRole(
			await ports.conversations.isSpawnedSubAgent(origin.sessionId),
			origin.depth,
		);

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

	const gatePermission = async (
		op: AgentControlOp,
		origin: AgentControlOrigin,
	): Promise<AgentControlResult<never> | null> => {
		const action = isWriteOp(op) ? 'app-control-write' : 'app-control-read';
		const mode = ports.permissions.getMode();
		const boundary = classifyPermissionAction({ action, mode }).boundary;
		if (boundary === 'blocked') {
			return fail('denied-permission', `Blocked by ${mode} permission mode.`);
		}
		if (boundary === 'confirmation-required') {
			const approved = await ports.confirm.confirm({
				origin,
				summary: `Agent requests ${op} in workspace ${origin.workspaceId}.`,
			});
			if (!approved) {
				return fail('denied-permission', 'The user declined the request.');
			}
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
	): Promise<'completed' | 'timeout' | undefined> => {
		if (!wait) {
			return undefined;
		}
		return ports.conversations.waitForIdle(
			agentSessionId,
			guardrails.waitTimeoutMs,
		);
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

	const handleStartConversation = async (
		origin: AgentControlOrigin,
		args: StartConversationArgs,
		callerModel: string | undefined,
	): Promise<AgentControlResult<unknown>> => {
		if (args.chatTabId) {
			const owner = await ports.tabs.resolveTabWorkspace(args.chatTabId);
			const scoped = outOfScope(owner, origin);
			if (scoped) {
				return scoped;
			}
		}
		const spawnDenied = evaluateSpawnGuard(origin);
		if (spawnDenied) {
			return spawnDenied;
		}
		const started = await ports.conversations.startConversation({
			workspaceId: origin.workspaceId,
			workspaceCwd: origin.workspaceCwd,
			chatTabId: args.chatTabId,
			prompt: args.prompt,
			model: args.model,
			thinkingLevel: args.thinkingLevel,
			title: args.title,
			callerModel,
			parentSessionId: origin.sessionId,
			planMode: isPlanning(origin),
		});
		guardrails.recordSpawn(origin.sessionId);
		const result = await waitIfRequested(started.agentSessionId, args.wait);
		return ok({ ...started, result });
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
		return ok(
			await ports.sessionNaming.setSummary({
				origin,
				summary: args.summary,
				title: args.title,
			}),
		);
	};

	/**
	 * Reports everything the Pi extension needs to assemble a turn's system
	 * prompt in one round trip: whether the session is planning, what naming
	 * upkeep it still owes, and the rendered upkeep block to append.
	 * @param origin - Resolved caller identity.
	 * @returns The session brief.
	 */
	const handleGetSessionBrief = async (
		origin: AgentControlOrigin,
	): Promise<AgentControlResult<unknown>> => {
		const naming = await ports.sessionNaming.readBrief(origin);
		return ok({
			naming,
			nudge: buildSessionBriefNudge(naming),
			planMode: isPlanning(origin),
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
	 * @returns The wait outcome, or a denial envelope.
	 */
	const handleSendFollowUp = async (
		origin: AgentControlOrigin,
		args: SendFollowUpArgs,
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
		const result = await waitIfRequested(args.agentSessionId, args.wait);
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
		});
		if (!started.ok) {
			return fail(startTerminalErrorCode(started.code), started.message);
		}
		guardrails.recordSpawn(origin.sessionId);
		return ok({ terminalId: started.terminalId });
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

	const handleFocusTab = async (
		origin: AgentControlOrigin,
		args: FocusTabArgs,
	): Promise<AgentControlResult<unknown>> => {
		const owner = await ports.tabs.resolveTabWorkspace(args.chatTabId);
		const scoped = outOfScope(owner, origin);
		if (scoped) {
			return scoped;
		}
		ports.focus.focusTab({
			workspaceId: origin.workspaceId,
			chatTabId: args.chatTabId,
		});
		return ok({ ok: true });
	};

	const handleFocusDockTab = async (
		origin: AgentControlOrigin,
		args: FocusDockTabArgs,
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
		const dock = args.terminalId
			? `terminal:${args.terminalId}`
			: (args.kind as string);
		ports.focus.focusDockTab({ workspaceId: origin.workspaceId, dock });
		return ok({ ok: true });
	};

	const handleFocusPanel = (
		origin: AgentControlOrigin,
		args: FocusPanelArgs,
	): AgentControlResult<unknown> => {
		ports.focus.focusPanel({
			workspaceId: origin.workspaceId,
			panel: args.panel,
		});
		return ok({ ok: true });
	};

	const handleSetWorkspaceStatus = (
		origin: AgentControlOrigin,
		args: SetWorkspaceStatusArgs,
	): AgentControlResult<unknown> => {
		ports.board.setWorkspaceStatus({
			workspaceId: origin.workspaceId,
			status: args.status,
		});
		return ok({ ok: true });
	};

	const handleGetWorkspaceStatus = (
		origin: AgentControlOrigin,
	): AgentControlResult<unknown> => {
		return ok({ status: ports.board.getWorkspaceStatus(origin.workspaceId) });
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

	// getWorkspaceDiff / getDiffComments / addDiffComments / resolveDiffComments
	// take their workspace from the origin rather than from an argument, so a
	// cross-workspace read or write is unreachable by construction and there is
	// nothing left to gate.
	const opHandlers: Record<AgentControlOp, OpHandler> = {
		addDiffComments: ({ args, origin }) =>
			ports.review
				.addComments({
					comments: (args as AddDiffCommentsArgs).comments,
					workspaceId: origin.workspaceId,
				})
				.then(ok),
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
			ports.review
				.listComments({
					file: (args as GetDiffCommentsArgs).filePath,
					workspaceId: origin.workspaceId,
				})
				.then(ok),
		getLastMessage: async ({ args }) =>
			ok({
				message: await ports.conversations.getLastMessage(
					(args as ConversationRef).agentSessionId,
				),
			} satisfies GetLastMessageResult),
		getSessionBrief: ({ origin }) => handleGetSessionBrief(origin),
		getWorkspaceDiff: ({ args, origin }) =>
			ports.diff
				.readWorkspaceDiff({
					file: (args as GetWorkspaceDiffArgs).filePath,
					stat: (args as GetWorkspaceDiffArgs).stat,
					workspaceCwd: origin.workspaceCwd,
					workspaceId: origin.workspaceId,
				})
				.then(ok),
		getWorkspaceStatus: ({ origin }) => handleGetWorkspaceStatus(origin),
		launchHarness: ({ args, origin }) =>
			handleLaunchHarness(origin, args as LaunchHarnessArgs),
		listModels: () => ports.conversations.listModels().then(ok),
		listRunScripts: ({ origin }) =>
			ports.terminals
				.listRunScripts({ workspaceId: origin.workspaceId })
				.then(ok),
		listTabs: ({ args, origin }) =>
			ports.tabs
				.listTabs({
					workspaceId: (args as ListTabsArgs).workspaceId ?? origin.workspaceId,
				})
				.then(ok),
		listTerminals: ({ args, origin }) =>
			ports.terminals
				.listTerminals({
					workspaceId:
						(args as ListTerminalsArgs).workspaceId ?? origin.workspaceId,
				})
				.then(ok),
		listWorkspaces: () => ports.workspaces.listWorkspaces().then(ok),
		notifyOrchestrator: ({ args, origin }) =>
			handleNotifyOrchestrator(origin, args as NotifyOrchestratorArgs),
		openTab: ({ args, origin }) => handleOpenTab(origin, args as OpenTabArgs),
		readConversation: ({ args }) =>
			ports.conversations.readTranscript(args as ReadConversationArgs).then(ok),
		readTerminalOutput: ({ args }) =>
			ports.terminals
				.readOutput((args as ReadTerminalOutputArgs).terminalId)
				.then(ok),
		resolveDiffComments: ({ args, origin }) =>
			ports.review
				.resolveComments({
					commentIds: (args as ResolveDiffCommentsArgs).commentIds,
					workspaceId: origin.workspaceId,
				})
				.then(ok),
		sendFollowUp: ({ args, origin }) =>
			handleSendFollowUp(origin, args as SendFollowUpArgs),
		setBranchName: ({ args, origin }) =>
			handleSetBranchName(origin, args as SetBranchNameArgs),
		setName: ({ args, origin }) => handleSetName(origin, args as SetNameArgs),
		setSummary: ({ args, origin }) =>
			handleSetSummary(origin, args as SetSummaryArgs),
		setWorkspaceStatus: ({ args, origin }) =>
			handleSetWorkspaceStatus(origin, args as SetWorkspaceStatusArgs),
		spawnChatTab: ({ args, origin }) =>
			handleSpawnChatTab(origin, args as SpawnChatTabArgs),
		startConversation: ({ args, callerModel, origin }) =>
			handleStartConversation(
				origin,
				args as StartConversationArgs,
				callerModel,
			),
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
		const permissionDenied = await gatePermission(command.op, origin);
		if (permissionDenied) {
			return permissionDenied;
		}
		try {
			return await dispatch(
				command.op,
				origin,
				validated.value,
				command.callerModel,
				command.signal,
			);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			return fail('internal', `Control op failed: ${detail}`);
		}
	};

	const describeAudience = async (token: string): Promise<ControlAudience> => {
		const origin = originRegistry.resolveByToken(token);
		if (!origin) {
			return { hasChatTab: false, role: 'orchestrator' };
		}
		return {
			hasChatTab: originHasChatTab(origin),
			role: await resolveRole(origin),
		};
	};

	const readSessionBriefNudge = async (
		sessionId: string,
	): Promise<string | null> => {
		const origin = originRegistry.resolveBySession(sessionId);
		if (!origin) {
			return null;
		}
		return buildSessionBriefNudge(await ports.sessionNaming.readBrief(origin));
	};

	const releaseSession = (sessionId: string): void => {
		ports.ask.releaseSession(sessionId);
		ports.planMode.releaseSession(sessionId);
		signalsByChild.delete(sessionId);
		guardrails.release(sessionId);
		originRegistry.release(sessionId);
	};

	return {
		describeAudience,
		invoke,
		readSessionBriefNudge,
		releaseSession,
	};
}
