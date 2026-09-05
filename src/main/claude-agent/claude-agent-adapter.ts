import { randomUUID } from 'node:crypto';

import {
	type Options,
	type Query,
	query,
	type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

import {
	DEFAULT_PERMISSION_MODE,
	type PermissionMode,
} from '../../shared/permissions.ts';
import {
	type AgentAdapter,
	type AgentAdapterCreateSessionInput,
	type AgentAdapterSession,
	createAgentErrorEmitter,
} from '../agent-runtime/agent-adapter.ts';
import type {
	AgentEvent,
	AgentEventListener,
	AgentSessionMetadata,
	AgentSessionState,
	AgentShutdownReason,
	AgentSubmitAcknowledgement,
	AgentSubmitRequest,
} from '../agent-runtime/agent-types.ts';
import { stripLaunchContextEnv } from '../environment/launch-env.ts';
import { createConciergeSessionGate } from './claude-concierge-guard.ts';
import { resolveSystemPromptAppend } from './claude-edit-tool-directive.ts';
import { buildClaudeMcpServers } from './claude-mcp-config.ts';
import {
	buildCanUseTool,
	type ClaudeApprovalGate,
	type ClaudeCanUseTool,
	resolvePermissionSettings,
} from './claude-permission-bridge.ts';
import {
	type ClaudePlanSubmittedEvent,
	detectPlanSubmission,
} from './claude-plan-mode.ts';
import { resolveDisallowedTools } from './claude-subagent-mode.ts';
import {
	CLAUDE_THINKING_CONFIG,
	steerClaudeThinking,
	toClaudeEffortLevel,
} from './claude-thinking.ts';
import { readPlanUsage } from './claude-usage.ts';
import { createPromptQueue } from './prompt-queue.ts';
import { createSdkMessageNormalizer } from './sdk-message-normalizer.ts';

/** Stderr the SDK forwards from the `claude` child, kept for error detail. */
const STDERR_RING_BYTES = 64 * 1024;

/**
 * How long a plan reading stays fresh before a sealing turn re-reads it.
 *
 * The read leaves the runtime for the claude.ai usage endpoint, so it must not
 * ride every turn; a window measured in hours moves slowly enough that five
 * minutes of staleness is invisible, while a chat left open all afternoon still
 * shows what the account currently stands at rather than what it did at open.
 */
const PLAN_USAGE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/** Options for {@link createClaudeAgentAdapter}. */
export interface CreateClaudeAgentAdapterOptions {
	/**
	 * Opens the per-tool approval seam for each session, used when the workspace
	 * is in `approval-required`. This is the single seam the live approval card
	 * attaches to; omitted, the adapter falls back to the allow-and-warn
	 * placeholder in `claude-permission-bridge.ts`. It is called per session
	 * rather than once, because the SDK's `canUseTool` arguments carry no session
	 * id and a prompt has to name the chat that is blocked on it.
	 */
	canUseTool?: ClaudeApprovalGate;
	/** Override the clock for deterministic event timestamps. */
	now?: () => Date;
	/** Override the turn id factory. */
	turnIdFactory?: () => string;
	/**
	 * Resolves the base environment the `claude` child runs under. Production
	 * wires the login-shell env so a packaged app launched from Finder still
	 * inherits the user's PATH (ADR 0003 / ADR 0031); the default is
	 * `process.env`.
	 */
	resolveBaseEnv?: () => NodeJS.ProcessEnv | Promise<NodeJS.ProcessEnv>;
	/** Called when Claude submits a plan through its native `ExitPlanMode` tool. */
	onPlanSubmitted?: (event: ClaudePlanSubmittedEvent) => void;
	/**
	 * Roots of the local plugins carrying Ensemblr's shipped Agent Skills, loaded
	 * per session so a skill never has to be installed into the user's
	 * `~/.claude` or repository. Read per session rather than captured, because
	 * one of the roots follows a setting the user can flip while the app runs;
	 * an empty list drops the option and leaves the session otherwise unchanged.
	 */
	readPluginDirectories?: () => readonly string[];
	/** Injection seam for tests; defaults to the SDK's own `query`. */
	queryFn?: typeof query;
	/**
	 * Reports the Concierge home when the session being opened is the Concierge's,
	 * and null for every workspace chat. A session it names runs behind the
	 * containment gate in `claude-concierge-guard.ts` instead of the workspace
	 * permission mapping, whatever mode the request carried — the Concierge is
	 * read-only outside its own folder by construction, not by configuration.
	 */
	resolveConciergeHome?: (session: {
		agentSessionId: string;
		cwd: string;
	}) => string | null;
}

/**
 * Builds the `AgentAdapter` that drives Claude Code through
 * `@anthropic-ai/claude-agent-sdk`.
 *
 * The SDK's `interrupt()`, `setModel()`, and `setPermissionMode()` exist only in
 * streaming-input mode, so each session holds a long-lived async generator and
 * pushes user turns into it — structurally the same as Pi's long-lived RPC
 * child, which is what lets both sit behind one adapter contract.
 *
 * Known parity gap: Pi streams partial tool output through
 * `tool_execution_update`, so a long `bash` fills its card as it runs. The
 * Agent SDK runs tools inside Claude Code and returns each `tool_result`
 * complete, so a Claude tool card shows a spinner until the result lands. Not
 * fixable from this side.
 * @param options - Clock, env resolver, plan hook, and test seams.
 * @returns The Claude {@link AgentAdapter}.
 */
export function createClaudeAgentAdapter(
	options: CreateClaudeAgentAdapterOptions = {},
): AgentAdapter {
	const now = options.now ?? (() => new Date());
	const turnIdFactory = options.turnIdFactory ?? (() => randomUUID());
	const resolveBaseEnv = options.resolveBaseEnv ?? (() => process.env);
	const queryFn = options.queryFn ?? query;
	const onPlanSubmitted = options.onPlanSubmitted;
	const canUseTool = options.canUseTool;
	const readPluginDirectories = options.readPluginDirectories ?? (() => []);
	const resolveConciergeHome = options.resolveConciergeHome ?? (() => null);

	const openSessions = new Set<AgentAdapterSession>();

	return {
		createSession: async (input) => {
			const baseEnv = await resolveBaseEnv();
			const session = createClaudeSession({
				baseEnv,
				canUseTool,
				conciergeHome: resolveConciergeHome({
					agentSessionId: input.request.agentSessionId,
					cwd: input.metadata.cwd,
				}),
				input,
				now,
				onClosed: (closed) => openSessions.delete(closed),
				onPlanSubmitted,
				pluginDirectories: readPluginDirectories(),
				queryFn,
				turnIdFactory,
			});
			openSessions.add(session);
			return session;
		},
		shutdown: async () => {
			const sessions = [...openSessions];
			openSessions.clear();
			await Promise.all(
				sessions.map((session) => session.close().catch(() => undefined)),
			);
		},
	};
}

/**
 * Opens one Claude session: starts the streaming-input `query()`, pumps its
 * messages through the normalizer into the listener fan-out, and exposes the
 * lifecycle methods the adapter contract requires.
 * @param options - Session inputs, clock, callbacks, and the query seam.
 * @returns The session handle.
 */
function createClaudeSession({
	baseEnv,
	canUseTool,
	conciergeHome,
	input,
	now,
	onClosed,
	onPlanSubmitted,
	pluginDirectories,
	queryFn,
	turnIdFactory,
}: {
	baseEnv: NodeJS.ProcessEnv;
	canUseTool?: ClaudeApprovalGate;
	conciergeHome: string | null;
	input: AgentAdapterCreateSessionInput;
	now: () => Date;
	onClosed: (session: AgentAdapterSession) => void;
	onPlanSubmitted?: CreateClaudeAgentAdapterOptions['onPlanSubmitted'];
	pluginDirectories: readonly string[];
	queryFn: typeof query;
	turnIdFactory: () => string;
}): AgentAdapterSession {
	const listeners = new Set<AgentEventListener>();
	const promptQueue = createPromptQueue({ held: true });
	const agentSessionId = input.request.agentSessionId;
	const approval = canUseTool?.({ agentSessionId }) ?? null;
	let metadata: AgentSessionMetadata = { ...input.metadata };
	let sessionName: string | null = null;
	let stderr = '';
	let closed = false;
	let activeQuery: Query | null = null;
	let appliedModel = input.request.modelOverride?.trim() || null;
	let appliedThinking = input.request.thinkingLevel?.trim() || null;
	const permissionMode =
		input.request.permissionMode ?? DEFAULT_PERMISSION_MODE;
	// Null means "the SDK moved the permission mode behind our back", which makes
	// the next turn re-assert whichever way the toggle is pointing.
	let appliedPlanMode: boolean | null = input.request.planMode === true;
	let currentTurnId: string | null = null;
	let planUsageReadAt: number | null = null;
	let planUsageRead: Promise<boolean> | null = null;
	let pendingEvents: readonly AgentEvent[] = [];
	let hasSubscribed = false;

	/**
	 * Fans one event out to every listener, holding it back until the first
	 * subscriber arrives. A failure raised while `query()` is still starting is
	 * reported before the caller has resumed from its `await` and could
	 * subscribe, so without the buffer that error and its shutdown are emitted
	 * to nobody and the session's failure is never surfaced.
	 * @param event - The event to deliver.
	 */
	const emit = (event: AgentEvent): void => {
		if (!hasSubscribed) {
			pendingEvents = [...pendingEvents, event];
			return;
		}
		for (const listener of [...listeners]) {
			try {
				listener(event);
			} catch (cause) {
				console.warn('[claude-agent] listener threw', cause);
			}
		}
	};

	/**
	 * Merges a metadata patch and announces the new snapshot.
	 * @param patch - Fields to overwrite on the session metadata.
	 */
	const patchMetadata = (patch: Partial<AgentSessionMetadata>): void => {
		metadata = { ...metadata, ...patch, updatedAt: now().toISOString() };
		emit({ at: metadata.updatedAt, metadata, type: 'metadata' });
	};

	const emitError = createAgentErrorEmitter({ emit, now });

	/**
	 * Ends the session once, announcing why. Every shutdown path funnels through
	 * here, which is why the approval seam is released from it: a prompt that
	 * outlives its session parks the tool call forever, and the user has no card
	 * left to answer it on.
	 * @param reason - What ended the session.
	 */
	const emitShutdown = (reason: AgentShutdownReason): void => {
		if (closed) {
			return;
		}
		closed = true;
		approval?.release();
		emit({ at: now().toISOString(), reason, type: 'shutdown' });
		onClosed(session);
	};

	const normalizer = createSdkMessageNormalizer({
		now,
		onDiscovery: ({ model, sessionId }) => {
			patchMetadata({ model: model ?? metadata.model, sessionId });
		},
	});

	const controlToken = input.request.controlMcp?.token ?? null;

	/**
	 * Asks the account what every plan window stands at and reports the answer as
	 * one event.
	 *
	 * The pushed `rate_limit_event` frames the composer otherwise relies on name
	 * only whichever window moved, and the SDK marks their utilization optional —
	 * so a chat can know a window resets in two hours without ever learning how
	 * much of it is gone. This read is where the figure comes from; the pushes
	 * layer their fresher status and reset on top of it.
	 *
	 * Only an answer marks the reading fresh. A read that fails leaves the stamp
	 * where it was so the next sealing turn asks again: the opening read runs
	 * before the child has necessarily answered a control request, and counting
	 * that failure as a reading would hold the card empty for the whole interval
	 * on exactly the path most likely to hit it. A session with no plan behind it
	 * — an API key, Bedrock, Vertex — answers with no windows, which is an answer:
	 * it stamps, emits nothing, and is not asked again until the stamp goes stale.
	 * @returns Whether the runtime answered, so a manual refresh can report that it did not.
	 */
	const readPlanWindows = async (): Promise<boolean> => {
		if (!activeQuery) {
			return false;
		}
		const askedAt = now().getTime();
		const usage = await readPlanUsage(activeQuery);
		if (!usage) {
			console.warn('[claude-agent] could not read the account plan usage.', {
				sessionId: agentSessionId,
			});
			return false;
		}
		planUsageReadAt = askedAt;
		// Guarded after the await, not before it: this asks whether the session died
		// during the control round trip, which hoisting it would stop it answering.
		if (closed || usage.limits.length === 0) {
			return true;
		}
		emit({
			at: now().toISOString(),
			type: 'plan-windows',
			windows: usage.limits,
		});
		return true;
	};

	/**
	 * Joins the caller onto the plan read already in flight rather than opening a
	 * second control round trip, so a user hammering the composer's refresh
	 * control costs the runtime one question and every caller settles on the same
	 * answer.
	 * @returns Whether the runtime answered.
	 */
	const probePlanUsage = (): Promise<boolean> => {
		planUsageRead ??= readPlanWindows().finally(() => {
			planUsageRead = null;
		});
		return planUsageRead;
	};

	/**
	 * Re-reads the plan once a turn seals, unless the last reading is still fresh.
	 * Sealing a turn is the moment spend actually moved, and the interval is what
	 * keeps a busy chat from spending a round trip on every one of them.
	 */
	const refreshStalePlanUsage = (): void => {
		const readAt = planUsageReadAt;
		const isFresh =
			readAt !== null &&
			now().getTime() - readAt < PLAN_USAGE_REFRESH_INTERVAL_MS;
		if (isFresh) {
			return;
		}
		void probePlanUsage();
	};

	/**
	 * Emits one normalized event and reports it as a plan submission when it is
	 * one, so plan mode sees the exit through the same stream as the timeline.
	 *
	 * The applied-mode reset runs whether or not anyone is listening for the
	 * submission: it is this session's own bookkeeping, and tying it to an
	 * optional callback would leave a listener-less adapter re-using a stale mode
	 * across the very transition it exists to catch.
	 * @param event - The normalized event to deliver.
	 */
	const forward = (event: AgentEvent): void => {
		emit(event);
		if (event.type === 'session-cost') {
			refreshStalePlanUsage();
		}
		const submission = detectPlanSubmission(event);
		if (!submission) {
			return;
		}
		// The SDK leaves plan mode as it runs its own `ExitPlanMode`, without
		// telling the adapter and without landing on the workspace's baseline.
		// Forgetting the applied value is what makes the next turn re-assert:
		// Refine has to restore `plan`, and Approve has to restore the baseline
		// rather than accept whatever the SDK picked.
		appliedPlanMode = null;
		onPlanSubmitted?.({ agentSessionId, controlToken, submission });
	};

	/**
	 * Drains the SDK's message stream until it ends, normalizing each message
	 * into events. A stream failure reports the collected stderr alongside the
	 * cause, then shuts the session down as crashed.
	 */
	const pump = async (): Promise<void> => {
		if (!activeQuery) {
			return;
		}
		try {
			for await (const message of activeQuery) {
				for (const event of normalizer.normalize(message)) {
					forward(event);
				}
			}
			emitShutdown('completed');
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : String(cause);
			emitError(
				'adapter-failure',
				'The Claude session ended unexpectedly.',
				[detail, stderr].filter(Boolean).join('\n\n'),
			);
			patchMetadata({ status: 'errored' });
			emitShutdown('crashed');
		}
	};

	/**
	 * Asks the runtime what this session's window is and how much of it the system
	 * prompt, tools and memory already occupy. Claude names its window nowhere in
	 * the message stream until a turn's `result`, so without this the gauge has no
	 * denominator for the whole of the first turn — and the account's own figure
	 * is the only trustworthy one, since the SDK's model catalog publishes none.
	 */
	const probeContextUsage = async (): Promise<void> => {
		if (!activeQuery) {
			return;
		}
		try {
			const usage = await activeQuery.getContextUsage();
			// Guarded after the await, not before it: this asks whether the session
			// died during the control round trip, which hoisting it would stop it
			// being able to answer.
			if (closed) {
				return;
			}
			for (const event of normalizer.observeContextUsage({
				contextWindow: usage.maxTokens,
				tokens: usage.totalTokens,
			})) {
				forward(event);
			}
		} catch (cause) {
			console.warn('[claude-agent] could not read the session context usage.', {
				cause: cause instanceof Error ? cause.message : String(cause),
				sessionId: agentSessionId,
			});
		}
	};

	/**
	 * Zeroes the thinking budget on a session whose chat opened at `off`. The
	 * `thinking` option cannot carry that state: opening the session `disabled`
	 * would pin a CLI flag no later steer can lift, leaving the chat unable to
	 * turn reasoning back on. So every session opens able to think, and one that
	 * should not is switched off here instead.
	 */
	const applyOpeningThinking = async (): Promise<void> => {
		if (!activeQuery || toClaudeEffortLevel(input.request.thinkingLevel)) {
			return;
		}
		try {
			await steerClaudeThinking(activeQuery, input.request.thinkingLevel);
		} catch (cause) {
			console.warn('[claude-agent] could not disable session thinking.', {
				cause: cause instanceof Error ? cause.message : String(cause),
				sessionId: agentSessionId,
			});
		}
	};

	try {
		activeQuery = queryFn({
			options: buildQueryOptions({
				baseEnv,
				canUseTool: approval?.canUseTool,
				conciergeHome,
				input,
				onStderr: (chunk) => {
					stderr = `${stderr}${chunk}`.slice(-STDERR_RING_BYTES);
				},
				pluginDirectories,
			}),
			prompt: promptQueue.stream,
		});
	} catch (cause) {
		const detail = cause instanceof Error ? cause.message : String(cause);
		queueMicrotask(() => {
			emitError('spawn-error', 'Failed to start Claude Code.', detail);
			patchMetadata({ status: 'errored' });
			emitShutdown('crashed');
		});
	}

	// The queue is held so the steer lands before the runtime reads a first turn.
	// `submit` deliberately does not wait on it: a yield between recording a
	// prompt and queueing it would let two overlapping submits reach the runtime
	// in the opposite order to the transcript.
	void applyOpeningThinking().finally(promptQueue.open);

	void pump();
	void probeContextUsage();
	void probePlanUsage();

	const session: AgentAdapterSession = {
		/**
		 * Interrupts the running turn, settles whatever it had streamed so far,
		 * and closes the session down.
		 */
		abort: async () => {
			try {
				await activeQuery?.interrupt();
			} catch (cause) {
				emitError(
					'adapter-failure',
					'Failed to interrupt the Claude turn.',
					cause instanceof Error ? cause.message : String(cause),
					true,
				);
			}
			for (const event of normalizer.settleTurn()) {
				emit(event);
			}
			promptQueue.close();
			activeQuery?.close();
			patchMetadata({ status: 'closed' });
			emitShutdown('aborted');
		},
		/** Ends the session on the user's request, leaving no turn in flight. */
		close: async () => {
			promptQueue.close();
			activeQuery?.close();
			if (!closed) {
				patchMetadata({ status: 'closed' });
				emitShutdown('manual');
			}
		},
		/** Returns the latest metadata snapshot. */
		getMetadata: () => metadata,
		/** Returns the runtime state the session service persists. */
		getState: async () => ({ sessionName }) as AgentSessionState,
		id: metadata.id,
		/**
		 * Re-reads the account's plan windows on demand, ignoring the freshness
		 * interval a sealing turn respects — the user asking is the signal that the
		 * figure on screen is the one they no longer trust.
		 * @returns Whether the runtime answered.
		 */
		refreshPlanUsage: () => probePlanUsage(),
		/**
		 * Records the session's display name.
		 * @param name - Name to store, blank to clear it.
		 */
		setSessionName: async (name) => {
			sessionName = name.trim() || null;
		},
		/**
		 * Registers an event listener, replaying anything emitted before the
		 * first subscriber arrived.
		 * @param listener - Receives every event the session emits.
		 * @returns A handle that detaches the listener.
		 */
		subscribe: (listener) => {
			listeners.add(listener);
			if (!hasSubscribed) {
				hasSubscribed = true;
				const buffered = pendingEvents;
				pendingEvents = [];
				for (const event of buffered) {
					emit(event);
				}
			}
			return {
				unsubscribe: () => {
					listeners.delete(listener);
				},
			};
		},
		/**
		 * Queues one prompt for Claude and reports the turn it belongs to.
		 *
		 * A steer or follow-up joins the turn already streaming rather than
		 * opening a new one: re-stamping the normalizer mid-turn would file that
		 * turn's still-draining messages under the interruption instead.
		 * @param request - The prompt plus any per-turn model or thinking change.
		 * @returns When the prompt was accepted, and its turn id.
		 */
		submit: async (request) => {
			if (closed) {
				throw new Error('Claude session is closed.');
			}
			const continuesTurn =
				request.streamingBehavior !== undefined && currentTurnId !== null;
			const turnId =
				continuesTurn && currentTurnId ? currentTurnId : turnIdFactory();
			await applyTurnSelection({
				activeQuery,
				appliedModel,
				appliedPlanMode,
				appliedThinking,
				permissionMode,
				request,
			});
			appliedModel = request.modelOverride?.trim() || appliedModel;
			appliedThinking = request.thinkingLevel?.trim() || appliedThinking;
			if (request.planMode !== undefined && !request.streamingBehavior) {
				appliedPlanMode = request.planMode;
			}

			if (!continuesTurn) {
				currentTurnId = turnId;
				normalizer.setTurnId(turnId);
			}
			// Resolved before the emit so nothing awaits between recording the
			// prompt and queueing it: two overlapping submits that yielded in
			// between would reach the runtime in the opposite order to the one the
			// transcript shows.
			const runtimePrompt = await withTurnPreamble(
				request.prompt,
				input.request,
			);
			emit({
				at: now().toISOString(),
				payload: { kind: 'prompt', prompt: request.prompt },
				role: 'user',
				turnId,
				type: 'message',
			});
			// The timeline keys its working indicator and turn timer off `status`
			// events, and Claude's first message is seconds away, so the turn is
			// announced open here rather than when the runtime finally answers.
			for (const event of normalizer.beginTurn()) {
				emit(event);
			}
			patchMetadata({ status: 'streaming' });

			promptQueue.push(toSdkUserMessage(runtimePrompt));

			const acknowledgement: AgentSubmitAcknowledgement = {
				acceptedAt: now().toISOString(),
				turnId,
			};
			return acknowledgement;
		},
	};

	patchMetadata({ status: 'starting' });

	return session;
}

/**
 * Applies a per-turn model, thinking, or Plan Mode change before the prompt is
 * pushed. Mirrors the Pi adapter's `set_model`/`set_thinking_level` behaviour:
 * only a genuine change round-trips, and a mid-turn steer skips the switch
 * entirely because the runtime is already committed to a turn.
 *
 * Plan Mode is re-asserted here rather than only at session open because
 * Claude's own `ExitPlanMode` tool drops the live session out of plan mode the
 * moment a plan is submitted. Ensemblr never sees that transition, so a chat
 * whose toggle is still on would otherwise keep planning in the UI while the
 * runtime had already been released to edit.
 * @param input - The live query, what is already applied, the workspace
 *   permission mode to fall back to, and the submission.
 */
async function applyTurnSelection({
	activeQuery,
	appliedModel,
	appliedPlanMode,
	appliedThinking,
	permissionMode,
	request,
}: {
	activeQuery: Query | null;
	appliedModel: string | null;
	/** Null once the SDK has moved the mode itself, forcing a re-assert. */
	appliedPlanMode: boolean | null;
	appliedThinking: string | null;
	permissionMode: PermissionMode;
	request: AgentSubmitRequest;
}): Promise<void> {
	if (!activeQuery || request.streamingBehavior) {
		return;
	}

	const model = request.modelOverride?.trim();
	if (model && model !== appliedModel) {
		await activeQuery.setModel(model);
	}

	const thinking = request.thinkingLevel?.trim();
	if (thinking && thinking !== appliedThinking) {
		await steerClaudeThinking(activeQuery, thinking);
	}

	const planMode = request.planMode;
	if (planMode !== undefined && planMode !== appliedPlanMode) {
		const { permissionMode: resolved } = resolvePermissionSettings({
			mode: permissionMode,
			planMode,
		});
		await activeQuery.setPermissionMode(resolved);
	}
}

/**
 * Maps the provider-neutral session request onto the SDK's `Options`. This is
 * the Claude counterpart of `buildPiSessionArgs`: every runtime-specific name
 * lives here and nowhere above the adapter seam.
 * @param input - Session inputs plus the base env, the stderr sink, and the shipped plugin root.
 * @returns The options for the opening `query()` call.
 */
function buildQueryOptions({
	baseEnv,
	canUseTool,
	conciergeHome,
	input,
	onStderr,
	pluginDirectories,
}: {
	baseEnv: NodeJS.ProcessEnv;
	canUseTool?: ClaudeCanUseTool;
	conciergeHome: string | null;
	input: AgentAdapterCreateSessionInput;
	onStderr: (chunk: string) => void;
	pluginDirectories: readonly string[];
}): Options {
	const { metadata, request } = input;
	const mode = request.permissionMode ?? DEFAULT_PERMISSION_MODE;
	const concierge = conciergeHome
		? createConciergeSessionGate(conciergeHome)
		: null;
	const permission =
		concierge?.permission ??
		resolvePermissionSettings({
			mode,
			planMode: request.planMode === true,
		});
	const effort = toClaudeEffortLevel(request.thinkingLevel);
	const executablePath = request.executable?.command?.trim();
	const mcpServers = buildClaudeMcpServers(request.controlMcp);
	const disallowedTools = resolveDisallowedTools({
		delegation: request.delegation ?? 'ensemblr',
		permissionDisallowedTools: permission.disallowedTools,
	});

	const linkedDirectories = request.linkedDirectories ?? [];
	const systemPromptAppend = resolveSystemPromptAppend({
		permissionMode: permission.permissionMode,
		systemPromptAppend: request.systemPromptAppend,
	});

	return {
		...permission,
		...(disallowedTools ? { disallowedTools } : {}),
		...(linkedDirectories.length > 0
			? { additionalDirectories: [...linkedDirectories] }
			: {}),
		canUseTool: concierge?.canUseTool ?? buildCanUseTool({ canUseTool, mode }),
		cwd: metadata.cwd,
		...(concierge ? { hooks: concierge.hooks } : {}),
		env: stripLaunchContextEnv({ ...baseEnv, ...metadata.env }),
		// Without this the SDK forwards only a subagent's tool_use/tool_result
		// blocks, so a `Task` card would nest tool rows with none of the prose that
		// explains them.
		forwardSubagentText: true,
		includePartialMessages: true,
		...(effort ? { effort } : {}),
		thinking: CLAUDE_THINKING_CONFIG,
		...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
		...(request.modelOverride?.trim()
			? { model: request.modelOverride.trim() }
			: {}),
		...(executablePath ? { pathToClaudeCodeExecutable: executablePath } : {}),
		// The SDK's sibling `skills` option is a context *filter*, not a switch:
		// naming ours there would hide every skill the user already has. Omitting
		// it leaves the CLI's own defaults in place, which is what we want.
		...(pluginDirectories.length > 0
			? {
					plugins: pluginDirectories.map((pluginRoot) => ({
						path: pluginRoot,
						type: 'local' as const,
					})),
				}
			: {}),
		...resolveSdkSessionIdentity({
			resumeRuntimeSession: request.resumeRuntimeSession === true,
			runtimeSessionId: metadata.sessionId,
		}),
		// Repo `CLAUDE.md` and project settings are exactly what a user expects a
		// first-class Claude chat to honour; the SDK opts out of all of them by
		// default, unlike the interactive CLI.
		settingSources: ['project', 'user'],
		stderr: onStderr,
		systemPrompt: {
			preset: 'claude_code',
			type: 'preset',
			...(systemPromptAppend ? { append: systemPromptAppend } : {}),
		},
	};
}

/**
 * Chooses between the SDK's two mutually exclusive session-identity options.
 *
 * `resume` "loads the conversation history from the specified session", so it is
 * only ever right for a runtime session that has already run — pointed at an id
 * Claude has no transcript for, the CLI exits 1 with `No conversation found with
 * session ID` before reaching the model. `sessionId` assigns the id up front and
 * "cannot be used with `continue` or `resume` unless `forkSession` is also set",
 * which this adapter never sets. A session with no runtime id yet gets neither,
 * leaving the SDK to generate one and report it back through the normalizer.
 * @param input - The runtime session id and whether the runtime already holds its history.
 * @returns The `resume` or `sessionId` fragment to spread into the SDK options.
 */
function resolveSdkSessionIdentity({
	resumeRuntimeSession,
	runtimeSessionId,
}: {
	resumeRuntimeSession: boolean;
	runtimeSessionId: string | null;
}): Pick<Options, 'resume' | 'sessionId'> {
	if (!runtimeSessionId) {
		return {};
	}
	return resumeRuntimeSession
		? { resume: runtimeSessionId }
		: { sessionId: runtimeSessionId };
}

/**
 * Wraps a prompt in the SDK's streaming-input user message shape.
 * @param prompt - The user's prompt text.
 * @returns The message to push into the input stream.
 */
function toSdkUserMessage(prompt: string): SDKUserMessage {
	return {
		message: { content: prompt, role: 'user' },
		parent_tool_use_id: null,
		type: 'user',
	};
}

/**
 * Prefixes a prompt with the app's per-turn upkeep block, when there is one.
 *
 * The SDK fixes `systemPrompt` at session open, so live state — what naming this
 * session still owes — has no other way in. It rides on the prompt the runtime
 * receives and not on the one the app persisted a moment earlier, so the block
 * never appears in the user's transcript. A resolver that throws is treated as
 * nothing outstanding: the block is a reminder, and losing one is cheaper than
 * failing the turn that carried it.
 * @param prompt - The prompt the user submitted.
 * @param request - The session's open request, carrying the resolver.
 * @returns The prompt to hand the runtime.
 */
async function withTurnPreamble(
	prompt: string,
	request: { resolveTurnPreamble?: (() => Promise<string | null>) | null },
): Promise<string> {
	try {
		const preamble = await request.resolveTurnPreamble?.();
		return preamble ? `${preamble}\n\n${prompt}` : prompt;
	} catch {
		return prompt;
	}
}
