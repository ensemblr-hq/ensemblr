/**
 * The agent → app control service. One trusted, main-process entry point that
 * both bridges (the Pi extension and the harness MCP server) funnel into. Every
 * call is validated, its origin resolved from an injected token, permission- and
 * scope-checked, guardrailed, then delegated to an existing service via a port.
 */
import type {
	AgentControlErrorCode,
	AgentControlOp,
	AgentControlResult,
	CloseTabArgs,
	ConversationRef,
	FocusDockTabArgs,
	FocusPanelArgs,
	FocusTabArgs,
	LaunchHarnessArgs,
	ListTabsArgs,
	ListTerminalsArgs,
	NotifyOrchestratorArgs,
	OpenTabArgs,
	OrchestratorSignal,
	ReadTerminalOutputArgs,
	SendFollowUpArgs,
	SpawnChatTabArgs,
	StartConversationArgs,
	StartTerminalArgs,
	StopTerminalArgs,
	WaitedAgent,
	WaitForAgentsArgs,
	WriteTerminalArgs,
} from '../../shared/agent-control.ts';
import { isWriteOp, validateArgs } from '../../shared/agent-control.ts';
import { classifyPermissionAction } from '../../shared/permissions.ts';
import type { Guardrails } from './guardrails.ts';
import type { OriginRegistry } from './origin-registry.ts';
import type { AgentControlOrigin, AgentControlPorts } from './ports.ts';

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
}

/** Public surface of the agent-control service. */
export interface AgentControlService {
	invoke: (
		command: AgentControlCommand,
	) => Promise<AgentControlResult<unknown>>;
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
	now: () => Date.now(),
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
		piSessionId: string,
		wait: boolean | undefined,
	): Promise<'completed' | 'timeout' | undefined> => {
		if (!wait) {
			return undefined;
		}
		return ports.conversations.waitForIdle(
			piSessionId,
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
			callerModel,
			parentSessionId: origin.sessionId,
		});
		guardrails.recordSpawn(origin.sessionId);
		const result = await waitIfRequested(started.piSessionId, args.wait);
		return ok({ ...started, result });
	};

	const handleSendFollowUp = async (
		origin: AgentControlOrigin,
		args: SendFollowUpArgs,
	): Promise<AgentControlResult<unknown>> => {
		const owner = await ports.conversations.resolveConversationWorkspace(
			args.piSessionId,
		);
		const scoped = outOfScope(owner, origin);
		if (scoped) {
			return scoped;
		}
		if (args.wait) {
			const deadlock = guardrails.evaluateWaitTarget(
				args.piSessionId,
				originRegistry.ancestorsOf(origin.sessionId),
			);
			if (!deadlock.ok) {
				return fail(deadlock.code, deadlock.reason);
			}
		}
		await ports.conversations.sendFollowUp({
			piSessionId: args.piSessionId,
			prompt: args.prompt,
		});
		const result = await waitIfRequested(args.piSessionId, args.wait);
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
		const created = await ports.terminals.startTerminal({
			workspaceId: origin.workspaceId,
			workspaceCwd: origin.workspaceCwd,
			kind: args.kind,
		});
		guardrails.recordSpawn(origin.sessionId);
		return ok(created);
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

	const handleNotifyOrchestrator = (
		origin: AgentControlOrigin,
		args: NotifyOrchestratorArgs,
	): AgentControlResult<unknown> => {
		if (!origin.parentSessionId) {
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

	const settleTarget = async (
		piSessionId: string,
	): Promise<{ agent: WaitedAgent; settled: boolean }> => {
		const status = (await ports.conversations.getStatus(piSessionId))?.status;
		const signal = signalsByChild.get(piSessionId) ?? null;
		const attention = signal !== null && ATTENTION_REASONS.has(signal.reason);
		const terminal = status === undefined || TERMINAL_STATUSES.has(status);
		const settled = terminal || attention;
		if (!settled) {
			return {
				agent: {
					piSessionId,
					status: status ?? 'unknown',
					lastMessage: null,
					signal,
				},
				settled: false,
			};
		}
		const lastMessage = await ports.conversations.getLastMessage(piSessionId);
		return {
			agent: {
				piSessionId,
				status: status ?? 'unknown',
				lastMessage,
				signal,
			},
			settled: true,
		};
	};

	const handleWaitForAgents = async (
		origin: AgentControlOrigin,
		args: WaitForAgentsArgs,
	): Promise<AgentControlResult<unknown>> => {
		const targets = args.targets ?? [
			...originRegistry.childrenOf(origin.sessionId),
		];
		if (targets.length === 0) {
			return ok({ completed: [], timedOut: false });
		}
		const ancestors = originRegistry.ancestorsOf(origin.sessionId);
		for (const target of targets) {
			const deadlock = guardrails.evaluateWaitTarget(target, ancestors);
			if (!deadlock.ok) {
				return fail(deadlock.code, deadlock.reason);
			}
		}
		const mode = args.mode ?? 'first';
		const timeoutMs = Math.min(
			args.timeoutMs ?? guardrails.waitTimeoutMs,
			guardrails.waitTimeoutMs,
		);
		const deadline = scheduler.now() + timeoutMs;
		for (;;) {
			const settled = await Promise.all(targets.map(settleTarget));
			const done = settled.filter((entry) => entry.settled);
			const satisfied =
				mode === 'first' ? done.length > 0 : done.length === targets.length;
			const expired = scheduler.now() >= deadline;
			if (satisfied || expired) {
				const completed = done.map((entry) => entry.agent);
				for (const entry of completed) {
					signalsByChild.delete(entry.piSessionId);
				}
				return ok({ completed, timedOut: !satisfied && expired });
			}
			await scheduler.sleep(WAIT_POLL_MS);
		}
	};

	const dispatch = async (
		op: AgentControlOp,
		origin: AgentControlOrigin,
		args: unknown,
		callerModel: string | undefined,
	): Promise<AgentControlResult<unknown>> => {
		switch (op) {
			case 'spawnChatTab':
				return handleSpawnChatTab(origin, args as SpawnChatTabArgs);
			case 'startConversation':
				return handleStartConversation(
					origin,
					args as StartConversationArgs,
					callerModel,
				);
			case 'sendFollowUp':
				return handleSendFollowUp(origin, args as SendFollowUpArgs);
			case 'closeTab':
				return handleCloseTab(origin, args as CloseTabArgs);
			case 'launchHarness':
				return handleLaunchHarness(origin, args as LaunchHarnessArgs);
			case 'startTerminal':
				return handleStartTerminal(origin, args as StartTerminalArgs);
			case 'stopTerminal':
				return handleStopTerminal(origin, args as StopTerminalArgs);
			case 'writeTerminal':
				return handleWriteTerminal(origin, args as WriteTerminalArgs);
			case 'openTab':
				return handleOpenTab(origin, args as OpenTabArgs);
			case 'focusTab':
				return handleFocusTab(origin, args as FocusTabArgs);
			case 'focusDockTab':
				return handleFocusDockTab(origin, args as FocusDockTabArgs);
			case 'focusPanel':
				return handleFocusPanel(origin, args as FocusPanelArgs);
			case 'listWorkspaces':
				return ok(await ports.workspaces.listWorkspaces());
			case 'listTabs':
				return ok(
					await ports.tabs.listTabs({
						workspaceId:
							(args as ListTabsArgs).workspaceId ?? origin.workspaceId,
					}),
				);
			case 'listTerminals':
				return ok(
					await ports.terminals.listTerminals({
						workspaceId:
							(args as ListTerminalsArgs).workspaceId ?? origin.workspaceId,
					}),
				);
			case 'getConversationStatus':
				return ok(
					await ports.conversations.getStatus(
						(args as ConversationRef).piSessionId,
					),
				);
			case 'getLastMessage':
				return ok(
					await ports.conversations.getLastMessage(
						(args as ConversationRef).piSessionId,
					),
				);
			case 'readTerminalOutput':
				return ok(
					await ports.terminals.readOutput(
						(args as ReadTerminalOutputArgs).terminalId,
					),
				);
			case 'listModels':
				return ok(await ports.conversations.listModels());
			case 'waitForAgents':
				return handleWaitForAgents(origin, args as WaitForAgentsArgs);
			case 'notifyOrchestrator':
				return handleNotifyOrchestrator(origin, args as NotifyOrchestratorArgs);
			default:
				return fail('invalid-args', `Unsupported operation: ${String(op)}.`);
		}
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
			);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			return fail('internal', `Control op failed: ${detail}`);
		}
	};

	const releaseSession = (sessionId: string): void => {
		signalsByChild.delete(sessionId);
		guardrails.release(sessionId);
		originRegistry.release(sessionId);
	};

	return { invoke, releaseSession };
}
