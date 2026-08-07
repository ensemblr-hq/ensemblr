import { randomUUID } from 'node:crypto';

import {
	type Options,
	type Query,
	query,
	type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

import { DEFAULT_PERMISSION_MODE } from '../../shared/permissions.ts';
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
import { buildClaudeMcpServers } from './claude-mcp-config.ts';
import {
	buildCanUseTool,
	type ClaudeApprovalGate,
	type ClaudeCanUseTool,
	resolveInitialPermissionSettings,
} from './claude-permission-bridge.ts';
import {
	type ClaudePlanSubmittedEvent,
	detectPlanSubmission,
} from './claude-plan-mode.ts';
import { toClaudeEffortLevel } from './claude-thinking.ts';
import { createPromptQueue } from './prompt-queue.ts';
import { createSdkMessageNormalizer } from './sdk-message-normalizer.ts';

/** Stderr the SDK forwards from the `claude` child, kept for error detail. */
const STDERR_RING_BYTES = 64 * 1024;

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
	/** Injection seam for tests; defaults to the SDK's own `query`. */
	queryFn?: typeof query;
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

	const openSessions = new Set<AgentAdapterSession>();

	return {
		createSession: async (input) => {
			const baseEnv = await resolveBaseEnv();
			const session = createClaudeSession({
				baseEnv,
				canUseTool,
				input,
				now,
				onClosed: (closed) => openSessions.delete(closed),
				onPlanSubmitted,
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
	input,
	now,
	onClosed,
	onPlanSubmitted,
	queryFn,
	turnIdFactory,
}: {
	baseEnv: NodeJS.ProcessEnv;
	canUseTool?: ClaudeApprovalGate;
	input: AgentAdapterCreateSessionInput;
	now: () => Date;
	onClosed: (session: AgentAdapterSession) => void;
	onPlanSubmitted?: CreateClaudeAgentAdapterOptions['onPlanSubmitted'];
	queryFn: typeof query;
	turnIdFactory: () => string;
}): AgentAdapterSession {
	const listeners = new Set<AgentEventListener>();
	const promptQueue = createPromptQueue();
	const agentSessionId = input.request.agentSessionId;
	const approval = canUseTool?.({ agentSessionId }) ?? null;
	let metadata: AgentSessionMetadata = { ...input.metadata };
	let sessionName: string | null = null;
	let stderr = '';
	let closed = false;
	let activeQuery: Query | null = null;
	let appliedModel = input.request.modelOverride?.trim() || null;
	let appliedThinking = input.request.thinkingLevel?.trim() || null;
	let currentTurnId: string | null = null;
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
	 * Emits one normalized event and reports it as a plan submission when it is
	 * one, so plan mode sees the exit through the same stream as the timeline.
	 * @param event - The normalized event to deliver.
	 */
	const forward = (event: AgentEvent): void => {
		emit(event);
		if (!onPlanSubmitted) {
			return;
		}
		const submission = detectPlanSubmission(event);
		if (submission) {
			onPlanSubmitted({ agentSessionId, controlToken, submission });
		}
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

	try {
		activeQuery = queryFn({
			options: buildQueryOptions({
				baseEnv,
				canUseTool: approval?.canUseTool,
				input,
				onStderr: (chunk) => {
					stderr = `${stderr}${chunk}`.slice(-STDERR_RING_BYTES);
				},
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

	void pump();

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
				appliedThinking,
				request,
			});
			appliedModel = request.modelOverride?.trim() || appliedModel;
			appliedThinking = request.thinkingLevel?.trim() || appliedThinking;

			if (!continuesTurn) {
				currentTurnId = turnId;
				normalizer.setTurnId(turnId);
			}
			emit({
				at: now().toISOString(),
				payload: { kind: 'prompt', prompt: request.prompt },
				role: 'user',
				turnId,
				type: 'message',
			});
			patchMetadata({ status: 'streaming' });

			promptQueue.push(toSdkUserMessage(request.prompt));

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
 * Applies a per-turn model or thinking change before the prompt is pushed.
 * Mirrors the Pi adapter's `set_model`/`set_thinking_level` behaviour: only a
 * genuine change round-trips, and a mid-turn steer skips the switch entirely
 * because the runtime is already committed to a turn.
 * @param input - The live query, what is already applied, and the submission.
 */
async function applyTurnSelection({
	activeQuery,
	appliedModel,
	appliedThinking,
	request,
}: {
	activeQuery: Query | null;
	appliedModel: string | null;
	appliedThinking: string | null;
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
		const effort = toClaudeEffortLevel(thinking);
		await activeQuery.applyFlagSettings({ effortLevel: effort });
	}
}

/**
 * Maps the provider-neutral session request onto the SDK's `Options`. This is
 * the Claude counterpart of `buildPiSessionArgs`: every runtime-specific name
 * lives here and nowhere above the adapter seam.
 * @param input - Session inputs plus the base env and the stderr sink.
 * @returns The options for the opening `query()` call.
 */
function buildQueryOptions({
	baseEnv,
	canUseTool,
	input,
	onStderr,
}: {
	baseEnv: NodeJS.ProcessEnv;
	canUseTool?: ClaudeCanUseTool;
	input: AgentAdapterCreateSessionInput;
	onStderr: (chunk: string) => void;
}): Options {
	const { metadata, request } = input;
	const mode = request.permissionMode ?? DEFAULT_PERMISSION_MODE;
	const permission = resolveInitialPermissionSettings({
		mode,
		planMode: request.planMode === true,
	});
	const effort = toClaudeEffortLevel(request.thinkingLevel);
	const executablePath = request.executable?.command?.trim();
	const mcpServers = buildClaudeMcpServers(request.controlMcp);

	return {
		...permission,
		canUseTool: buildCanUseTool({ canUseTool, mode }),
		cwd: metadata.cwd,
		env: stripLaunchContextEnv({ ...baseEnv, ...metadata.env }),
		includePartialMessages: true,
		...(effort ? { effort } : { maxThinkingTokens: 0 }),
		...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
		...(request.modelOverride?.trim()
			? { model: request.modelOverride.trim() }
			: {}),
		...(executablePath ? { pathToClaudeCodeExecutable: executablePath } : {}),
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
			...(request.systemPromptAppend
				? { append: request.systemPromptAppend }
				: {}),
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
