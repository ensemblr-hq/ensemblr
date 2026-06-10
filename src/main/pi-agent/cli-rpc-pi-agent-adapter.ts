import {
	type ChildProcessByStdio,
	spawn as nodeSpawn,
} from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Readable, Writable } from 'node:stream';

import { createJsonlLineStream } from './jsonl-line-stream.ts';
import type {
	PiAgentAdapter,
	PiAgentAdapterCreateSessionInput,
	PiAgentAdapterSession,
} from './pi-agent-adapter.ts';
import type {
	PiAgentError,
	PiAgentErrorCode,
	PiAgentEvent,
	PiAgentEventListener,
	PiAgentSessionMetadata,
	PiAgentSessionStatus,
	PiAgentShutdownReason,
	PiAgentSubmitAcknowledgement,
	PiAgentSubmitRequest,
	PiAgentSubscription,
} from './pi-agent-types.ts';
import {
	extractMessageId,
	isMessageRole,
	normalizeLegacyMessageFrame,
	normalizeMessageEnd,
	normalizeToolExecutionFrame,
} from './pi-wire-normalizer.ts';

export { normalizePiPayload } from './pi-wire-normalizer.ts';

const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;
const DEFAULT_STDERR_RING_BYTES = 64 * 1024;
const DEFAULT_KILL_GRACE_MS = 750;

/** Spawned process surface the adapter depends on, abstracted for tests. */
export type ChildLike = ChildProcessByStdio<Writable, Readable, Readable>;

/** Factory injected by tests; defaults to `node:child_process.spawn`. */
export type SpawnFn = (input: {
	args: readonly string[];
	command: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
}) => ChildLike;

/** Options for {@link createCliRpcPiAgentAdapter}. */
export interface CreateCliRpcPiAgentAdapterOptions {
	/** Override the spawner; default uses `node:child_process.spawn`. */
	spawn?: SpawnFn;
	/** Override the clock for deterministic event timestamps. */
	now?: () => Date;
	/** Override the turn id factory. */
	turnIdFactory?: () => string;
	/** Per-line byte cap forwarded to the JSONL stream. */
	maxLineBytes?: number;
	/** Stderr ring buffer cap. */
	stderrRingBytes?: number;
	/** SIGTERM → SIGKILL grace window when terminating the child. */
	killGraceMs?: number;
}

/**
 * Builds the production `PiAgentAdapter` that drives `pi --mode rpc`. The
 * spawn fields live on `metadata` (`command`, `args`, `cwd`, `env`) per the
 * adapter contract.
 *
 * Lifecycle:
 *  - `createSession` spawns the child, attaches JSONL parsing on stdout and a
 *    ring-buffered stderr capture, and emits a `metadata` event.
 *  - `submit` writes a request frame to stdin. Parsed events stream out
 *    asynchronously through the listener fan-out.
 *  - `abort` sends SIGINT then SIGKILL after a grace window.
 *  - `close` waits for graceful exit, then SIGTERM/SIGKILL if needed.
 *  - Crashes, invalid JSON, oversize lines, and exit≠0 surface as typed
 *    `error` events — never thrown on the hot path.
 */
export function createCliRpcPiAgentAdapter(
	options: CreateCliRpcPiAgentAdapterOptions = {},
): PiAgentAdapter {
	const spawnFn = options.spawn ?? defaultSpawn;
	const now = options.now ?? (() => new Date());
	const turnIdFactory = options.turnIdFactory ?? (() => randomUUID());
	const maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
	const stderrRingBytes = options.stderrRingBytes ?? DEFAULT_STDERR_RING_BYTES;
	const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;

	const openSessions = new Set<CliRpcSession>();

	const adapter: PiAgentAdapter = {
		createSession: async (input) => {
			const session = createCliRpcSession({
				input,
				killGraceMs,
				maxLineBytes,
				now,
				onClosed: (s) => openSessions.delete(s),
				spawnFn,
				stderrRingBytes,
				turnIdFactory,
			});
			openSessions.add(session);
			return session.publicSession;
		},
		shutdown: async () => {
			const sessions = [...openSessions];
			openSessions.clear();
			await Promise.all(
				sessions.map((session) =>
					session.publicSession.close().catch(() => undefined),
				),
			);
		},
	};

	return adapter;
}

interface CliRpcSession {
	publicSession: PiAgentAdapterSession;
}

function createCliRpcSession({
	input,
	killGraceMs,
	maxLineBytes,
	now,
	onClosed,
	spawnFn,
	stderrRingBytes,
	turnIdFactory,
}: {
	input: PiAgentAdapterCreateSessionInput;
	killGraceMs: number;
	maxLineBytes: number;
	now: () => Date;
	onClosed: (session: CliRpcSession) => void;
	spawnFn: SpawnFn;
	stderrRingBytes: number;
	turnIdFactory: () => string;
}): CliRpcSession {
	const listeners = new Set<PiAgentEventListener>();
	const stderrRing = createRingBuffer(stderrRingBytes);
	let metadata: PiAgentSessionMetadata = { ...input.metadata };
	let closed = false;
	let killTimer: NodeJS.Timeout | null = null;
	let pendingShutdownReason: PiAgentShutdownReason | null = null;

	const emit = (event: PiAgentEvent): void => {
		for (const listener of [...listeners]) {
			try {
				listener(event);
			} catch {
				// Per adapter contract: a throwing listener must not block peers.
			}
		}
	};

	const patchMetadata = (
		patch: Partial<PiAgentSessionMetadata>,
		options: { silent?: boolean } = {},
	): PiAgentSessionMetadata => {
		metadata = {
			...metadata,
			...patch,
			updatedAt: now().toISOString(),
		};
		if (!options.silent) {
			emit({ at: metadata.updatedAt, metadata, type: 'metadata' });
		}
		return metadata;
	};

	const setStatus = (next: PiAgentSessionStatus): void => {
		const previous = metadata.status;
		if (previous === next) {
			return;
		}
		patchMetadata({ status: next }, { silent: true });
		emit({
			at: metadata.updatedAt,
			previous,
			status: next,
			type: 'status',
		});
	};

	const emitError = (
		code: PiAgentErrorCode,
		message: string,
		detail?: string,
		recoverable = false,
	): void => {
		const error: PiAgentError = { code, detail, message, recoverable };
		emit({ at: now().toISOString(), error, type: 'error' });
	};

	let child: ChildLike;
	try {
		child = spawnFn({
			args: metadata.args,
			command: metadata.command,
			cwd: metadata.cwd,
			env: buildSpawnEnv(metadata.env),
		});
	} catch (cause) {
		const detail = cause instanceof Error ? cause.message : String(cause);
		patchMetadata({ status: 'errored' }, { silent: true });
		const placeholder: PiAgentAdapterSession = {
			abort: async () => undefined,
			close: async () => undefined,
			getMetadata: () => metadata,
			id: metadata.id,
			subscribe: (listener) => {
				listeners.add(listener);
				queueMicrotask(() => {
					if (!listeners.has(listener)) {
						return;
					}
					try {
						listener({
							at: now().toISOString(),
							error: {
								code: 'spawn-error',
								detail,
								message: 'Failed to spawn the Pi RPC process.',
								recoverable: false,
							},
							type: 'error',
						});
						listener({
							at: now().toISOString(),
							reason: 'crashed',
							type: 'shutdown',
						});
					} catch {
						// fan-out contract: ignore listener errors
					}
				});
				return {
					unsubscribe: () => {
						listeners.delete(listener);
					},
				};
			},
			submit: async () => {
				throw new Error('Cannot submit: Pi RPC process failed to spawn.');
			},
		};
		const wrapper: CliRpcSession = { publicSession: placeholder };
		return wrapper;
	}

	patchMetadata({ status: 'starting' });

	const pendingStatsIds = new Set<string>();

	const requestContextUsage = (): void => {
		if (closed || !child.stdin.writable) {
			return;
		}
		const id = turnIdFactory();
		pendingStatsIds.add(id);
		const frame = { id, type: 'get_session_stats' as const };
		const line = `${JSON.stringify(frame)}\n`;
		try {
			child.stdin.write(line, 'utf8');
		} catch {
			pendingStatsIds.delete(id);
		}
	};

	const lineStream = createJsonlLineStream({
		maxLineBytes,
		onLine: (line) => {
			if (line.length === 0) {
				return;
			}
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				emitError(
					'adapter-failure',
					'Invalid JSON line on Pi RPC stdout.',
					`bytes=${Buffer.byteLength(line, 'utf8')}, preview=${line.slice(0, 80)}`,
					true,
				);
				return;
			}
			handleProtocolFrame(parsed);
		},
		onOversize: ({ droppedBytes, firstBytes }) => {
			emitError(
				'adapter-failure',
				`Discarded oversize Pi RPC line (${droppedBytes} bytes > ${maxLineBytes} cap).`,
				firstBytes,
				true,
			);
		},
	});

	const handleProtocolFrame = (frame: unknown): void => {
		if (!frame || typeof frame !== 'object') {
			emitError(
				'adapter-failure',
				'Pi RPC frame was not a JSON object.',
				JSON.stringify(frame).slice(0, 200),
				true,
			);
			return;
		}

		const typed = frame as Record<string, unknown>;
		switch (typed.type) {
			// `session` (legacy/future) — explicit session id frame.
			case 'session': {
				const sessionId =
					typeof typed.sessionId === 'string' ? typed.sessionId : null;
				if (sessionId) {
					patchMetadata({ sessionId });
				}
				setStatus('streaming');
				return;
			}
			// Pi command ack: `{"type":"response","command":"prompt","success":bool}`.
			case 'response': {
				const success = typed.success !== false;
				const responseId = typeof typed.id === 'string' ? typed.id : null;
				if (responseId && pendingStatsIds.has(responseId)) {
					pendingStatsIds.delete(responseId);
					if (success) {
						const usage = extractContextUsage(typed.data);
						if (usage) {
							emit({
								at: now().toISOString(),
								type: 'context-usage',
								usage,
							});
						}
					}
					return;
				}
				if (!success) {
					emitError(
						'adapter-failure',
						typeof typed.error === 'string'
							? typed.error
							: 'Pi RPC command failed.',
						typeof typed.command === 'string'
							? `command=${typed.command}`
							: undefined,
						true,
					);
				}
				return;
			}
			// Pi lifecycle: `agent_start` / `agent_end` / `turn_start` / `turn_end`.
			case 'agent_start':
				setStatus('streaming');
				return;
			case 'turn_start':
				return;
			case 'turn_end':
			case 'agent_end':
				setStatus('idle');
				requestContextUsage();
				return;
			// Pi message lifecycle.
			//   message_start: new assistant message begins — record turnId only.
			//   message_update: carries `assistantMessageEvent` text/thinking deltas.
			//     The adapter swallows these today: only the final `message_end`
			//     is materialized so the persisted timeline holds one row per
			//     assistant message rather than one row per token.
			//   message_end: full `message` object with role + content[] blocks.
			case 'message_start':
			case 'message_update':
				return;
			case 'message_end': {
				const message = (typed.message ?? {}) as Record<string, unknown>;
				const wireRole = isMessageRole(message.role) ? message.role : 'agent';
				const turnId =
					typeof typed.turnId === 'string'
						? typed.turnId
						: (extractMessageId(typed.message) ?? 'pending');
				const normalized = normalizeMessageEnd(message, wireRole);
				emit({
					at: now().toISOString(),
					payload: normalized,
					role: wireRole,
					turnId,
					type: 'message',
				});
				return;
			}
			// Tool execution lifecycle from Pi docs.
			case 'tool_execution_start':
			case 'tool_execution_update':
			case 'tool_execution_end': {
				const turnId =
					typeof typed.turnId === 'string'
						? typed.turnId
						: typeof typed.toolCallId === 'string'
							? typed.toolCallId
							: null;
				const normalized = normalizeToolExecutionFrame(typed);
				emit({
					at: now().toISOString(),
					payload: normalized,
					role: 'tool',
					turnId,
					type: 'message',
				});
				return;
			}
			// Legacy / fallback shapes.
			case 'tool_call':
			case 'tool_result':
			case 'message': {
				const role = isMessageRole(typed.role)
					? typed.role
					: typed.type === 'tool_result' || typed.type === 'tool_call'
						? 'tool'
						: 'agent';
				const turnId = typeof typed.turnId === 'string' ? typed.turnId : null;
				const normalized = normalizeLegacyMessageFrame(typed, role);
				emit({
					at: now().toISOString(),
					payload: normalized,
					role,
					turnId,
					type: 'message',
				});
				return;
			}
			case 'status': {
				const status = isSessionStatus(typed.status)
					? typed.status
					: 'streaming';
				setStatus(status);
				return;
			}
			case 'error': {
				emitError(
					'adapter-failure',
					typeof typed.message === 'string' ? typed.message : 'Pi RPC error.',
					typeof typed.detail === 'string' ? typed.detail : undefined,
					typed.recoverable !== false,
				);
				return;
			}
			default: {
				// Unknown frame — surface as agent message so the timeline at least
				// records it instead of dropping silently. Future versions of Pi may
				// add frame types we have not modelled yet.
				const frameType =
					typeof typed.type === 'string' ? typed.type : 'unknown';
				emit({
					at: now().toISOString(),
					payload: { frameType, kind: 'unknown', raw: typed },
					role: 'agent',
					turnId: typeof typed.turnId === 'string' ? typed.turnId : null,
					type: 'message',
				});
				return;
			}
		}
	};

	child.stdout.on('data', (chunk: Buffer) => {
		lineStream.feed(chunk);
	});
	child.stdout.on('end', () => {
		lineStream.flush();
	});
	child.stderr.on('data', (chunk: Buffer) => {
		stderrRing.write(chunk);
		emit({
			at: now().toISOString(),
			error: {
				code: 'adapter-failure',
				detail: chunk.toString('utf8'),
				message: 'Pi RPC stderr',
				recoverable: true,
			},
			type: 'error',
		});
	});

	child.on('error', (cause: Error) => {
		emitError('spawn-error', 'Pi RPC process emitted an error.', cause.message);
	});

	child.on('exit', (code, signal) => {
		clearKillTimer();
		const reason: PiAgentShutdownReason = pendingShutdownReason
			? pendingShutdownReason
			: code === 0
				? 'completed'
				: 'crashed';
		if (reason === 'crashed' && code !== null) {
			emitError(
				'adapter-failure',
				`Pi RPC process exited with code ${code}.`,
				signal ? `signal=${signal}` : undefined,
			);
		}
		if (reason === 'crashed' && code === null && signal) {
			emitError(
				'adapter-failure',
				`Pi RPC process killed by signal ${signal}.`,
				stderrRing.snapshot(),
			);
		}
		finalizeShutdown(reason);
	});

	const finalizeShutdown = (reason: PiAgentShutdownReason): void => {
		if (closed) {
			return;
		}
		closed = true;
		patchMetadata({ status: 'closed' }, { silent: true });
		emit({ at: now().toISOString(), reason, type: 'shutdown' });
		listeners.clear();
		lineStream.reset();
		onClosed({ publicSession });
	};

	const clearKillTimer = (): void => {
		if (killTimer) {
			clearTimeout(killTimer);
			killTimer = null;
		}
	};

	const sendSignal = (signal: NodeJS.Signals): void => {
		try {
			child.kill(signal);
		} catch {
			// Already exited.
		}
	};

	const attachListener = (
		listener: PiAgentEventListener,
	): PiAgentSubscription => {
		listeners.add(listener);
		// Replay current status so late subscribers can render the right state.
		queueMicrotask(() => {
			if (!listeners.has(listener)) {
				return;
			}
			try {
				listener({
					at: metadata.updatedAt,
					metadata,
					type: 'metadata',
				});
			} catch {
				// fan-out contract: never let one listener break others
			}
		});
		return {
			unsubscribe: () => {
				listeners.delete(listener);
			},
		};
	};

	const submit = async (
		request: PiAgentSubmitRequest,
	): Promise<PiAgentSubmitAcknowledgement> => {
		if (closed) {
			throw new Error('Pi RPC session is closed.');
		}
		const turnId = turnIdFactory();
		const acceptedAt = now().toISOString();
		// Pi RPC protocol (@earendil-works/pi-coding-agent >= 0.79):
		//   {"type":"prompt","message":"<text>"}
		// `turnId` and attachments are Ensemble-side metadata that the runtime
		// ignores today; we keep them on the frame so a future Pi build that
		// accepts them needs no client change.
		const frame = {
			attachments: request.attachments ?? [],
			message: request.prompt,
			modelOverride: request.modelOverride,
			turnId,
			type: 'prompt' as const,
		};
		const line = `${JSON.stringify(frame)}\n`;
		const writeResult = child.stdin.write(line, 'utf8');
		if (!writeResult) {
			await new Promise<void>((resolve) => child.stdin.once('drain', resolve));
		}
		setStatus('streaming');
		return { acceptedAt, turnId };
	};

	const abort = async (reason?: string): Promise<void> => {
		if (closed) {
			return;
		}
		pendingShutdownReason = 'aborted';
		emitError('adapter-failure', 'Pi RPC session aborted.', reason, true);
		sendSignal('SIGINT');
		killTimer = setTimeout(() => {
			sendSignal('SIGKILL');
		}, killGraceMs);
	};

	const close = async (): Promise<void> => {
		if (closed) {
			return;
		}
		pendingShutdownReason = pendingShutdownReason ?? 'manual';
		try {
			child.stdin.end();
		} catch {
			// stdin may already be closed.
		}
		sendSignal('SIGTERM');
		killTimer = setTimeout(() => {
			sendSignal('SIGKILL');
		}, killGraceMs);
	};

	const publicSession: PiAgentAdapterSession = {
		abort,
		close,
		getMetadata: () => metadata,
		id: metadata.id,
		subscribe: attachListener,
		submit,
	};

	const wrapper: CliRpcSession = { publicSession };
	return wrapper;
}

function defaultSpawn({
	args,
	command,
	cwd,
	env,
}: {
	args: readonly string[];
	command: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
}): ChildLike {
	return nodeSpawn(command, Array.from(args), {
		cwd,
		env,
		shell: false,
		stdio: ['pipe', 'pipe', 'pipe'],
	}) as ChildLike;
}

function buildSpawnEnv(overlay: Record<string, string>): NodeJS.ProcessEnv {
	return { ...process.env, ...overlay };
}

function createRingBuffer(maxBytes: number): {
	snapshot: () => string;
	write: (chunk: Buffer) => void;
} {
	let stored = Buffer.alloc(0);
	return {
		snapshot: () => stored.toString('utf8'),
		write: (chunk: Buffer) => {
			if (chunk.length === 0) {
				return;
			}
			const combined = Buffer.concat([stored, chunk]);
			stored =
				combined.length > maxBytes
					? combined.subarray(combined.length - maxBytes)
					: combined;
		},
	};
}

function isSessionStatus(value: unknown): value is PiAgentSessionStatus {
	return (
		value === 'closed' ||
		value === 'errored' ||
		value === 'idle' ||
		value === 'starting' ||
		value === 'streaming'
	);
}

/**
 * Extracts the `contextUsage` block from a pi `get_session_stats` response.
 * Returns null when the response doesn't include usage data (e.g. right after
 * compaction). Tolerates both top-level and nested shapes for forward
 * compatibility.
 */
function extractContextUsage(data: unknown): {
	contextWindow: number;
	percent: number | null;
	tokens: number | null;
} | null {
	if (!data || typeof data !== 'object') {
		return null;
	}
	const root = data as Record<string, unknown>;
	const candidate =
		root.contextUsage && typeof root.contextUsage === 'object'
			? (root.contextUsage as Record<string, unknown>)
			: root;
	const contextWindow =
		typeof candidate.contextWindow === 'number' ? candidate.contextWindow : 0;
	if (contextWindow <= 0) {
		return null;
	}
	const tokens = typeof candidate.tokens === 'number' ? candidate.tokens : null;
	const percent =
		typeof candidate.percent === 'number' ? candidate.percent : null;
	return { contextWindow, percent, tokens };
}
