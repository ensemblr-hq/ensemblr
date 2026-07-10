import { randomUUID } from 'node:crypto';

import { bindChildStreams } from './cli-rpc/child-streams.ts';
import { createKillTimer } from './cli-rpc/kill-timer.ts';
import { createPiRpcLineStream } from './cli-rpc/line-stream-handlers.ts';
import { createListenerFanout } from './cli-rpc/listener-fanout.ts';
import { createProtocolDispatcher } from './cli-rpc/protocol-dispatch.ts';
import { createRingBuffer } from './cli-rpc/ring-buffer.ts';
import {
	buildSpawnEnv,
	type ChildLike,
	defaultSpawn,
	type ResolveBaseEnv,
	type SpawnFn,
} from './cli-rpc/spawn-env.ts';
import { createSpawnFailureSession } from './cli-rpc/spawn-failure-session.ts';
import type {
	PiAgentAdapter,
	PiAgentAdapterCreateSessionInput,
	PiAgentAdapterSession,
} from './pi-agent-adapter.ts';
import type {
	PiAgentError,
	PiAgentErrorCode,
	PiAgentEventListener,
	PiAgentSessionMetadata,
	PiAgentSessionStatus,
	PiAgentShutdownReason,
	PiAgentSubmitAcknowledgement,
	PiAgentSubmitRequest,
} from './pi-agent-types.ts';

export type { ChildLike, SpawnFn } from './cli-rpc/spawn-env.ts';
export { normalizePiPayload } from './pi-wire-normalizer.ts';

const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;
const DEFAULT_STDERR_RING_BYTES = 64 * 1024;
const DEFAULT_KILL_GRACE_MS = 750;

/** Raw JSONL line crossing the Pi RPC boundary, surfaced for debug only. */
export interface PiRawFrameSample {
	at: string;
	direction: 'rx' | 'tx';
	label: string;
	line: string;
	sessionId: string;
}

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
	/**
	 * Resolves the base environment the Pi child spawns under. Defaults to the
	 * Electron `process.env`; production wires this to the login-shell env so a
	 * packaged app launched from Finder inherits the user's PATH. Without it pi
	 * resolves by absolute path but its own tool lookups fail and it exits,
	 * surfacing later as an EPIPE on the first prompt write.
	 */
	resolveBaseEnv?: ResolveBaseEnv;
	/**
	 * Debug-only tap into every JSONL line crossing the Pi RPC boundary. Called
	 * for both stdout reads (`rx`) and stdin writes (`tx`). Skipped when not
	 * set so production paths pay no overhead.
	 */
	onRawFrame?: (frame: PiRawFrameSample) => void;
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
	const onRawFrame = options.onRawFrame;
	const resolveBaseEnv = options.resolveBaseEnv ?? (() => process.env);

	const openSessions = new Set<CliRpcSession>();

	const adapter: PiAgentAdapter = {
		createSession: async (input) => {
			// Resolve the login-shell env before spawning so the child inherits the
			// user's PATH even when the app was launched from Finder (minimal PATH).
			const baseEnv = await resolveBaseEnv();
			const session = createCliRpcSession({
				baseEnv,
				input,
				killGraceMs,
				maxLineBytes,
				now,
				onClosed: (s) => openSessions.delete(s),
				onRawFrame,
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

/**
 * Awaits a `drain` after a backpressured stdin write, but loses the race to a
 * dying pipe: without the `close`/`error` guards a write that backpressures
 * exactly as the Pi child exits would await a `drain` that never fires and hang
 * the turn forever. A large prompt frame can exceed the pipe buffer and trigger
 * the backpressure path, so this is reachable, not just theoretical.
 * @param stdin - The child's stdin pipe to wait on.
 * @returns Resolves on `drain`; rejects if the pipe closes or errors first.
 */
function awaitStdinDrain(stdin: NodeJS.WritableStream): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const cleanup = () => {
			stdin.off('drain', onDrain);
			stdin.off('close', onClose);
			stdin.off('error', onError);
		};
		const onDrain = () => {
			cleanup();
			resolve();
		};
		const onClose = () => {
			cleanup();
			reject(new Error('Pi RPC stdin closed before the write drained.'));
		};
		const onError = (cause: Error) => {
			cleanup();
			reject(new Error(`Pi RPC stdin write failed: ${cause.message}`));
		};
		stdin.once('drain', onDrain);
		stdin.once('close', onClose);
		stdin.once('error', onError);
	});
}

/** Internal handle wrapping one CLI RPC session's public surface. */
interface CliRpcSession {
	publicSession: PiAgentAdapterSession;
}

/**
 * Spawn a Pi CLI child and wire it into a session that emits agent events and
 * enforces kill-escalation on shutdown.
 * @param options - Spawn inputs, timing, callbacks, and per-session config.
 * @returns The internal session handle.
 */
function createCliRpcSession({
	baseEnv,
	input,
	killGraceMs,
	maxLineBytes,
	now,
	onClosed,
	onRawFrame,
	spawnFn,
	stderrRingBytes,
	turnIdFactory,
}: {
	baseEnv: NodeJS.ProcessEnv;
	input: PiAgentAdapterCreateSessionInput;
	killGraceMs: number;
	maxLineBytes: number;
	now: () => Date;
	onClosed: (session: CliRpcSession) => void;
	onRawFrame: ((frame: PiRawFrameSample) => void) | undefined;
	spawnFn: SpawnFn;
	stderrRingBytes: number;
	turnIdFactory: () => string;
}): CliRpcSession {
	const listeners = new Set<PiAgentEventListener>();
	const stderrRing = createRingBuffer(stderrRingBytes);
	const killTimer = createKillTimer();
	let metadata: PiAgentSessionMetadata = { ...input.metadata };
	let closed = false;
	let pendingShutdownReason: PiAgentShutdownReason | null = null;
	// Track the model/thinking already applied to the runtime so a per-turn
	// submit only emits `set_model`/`set_thinking_level` when the selection
	// actually changes. Seed both from the spawn-time flags (`--model` /
	// `--thinking` recorded in metadata.args) — the ground truth the process
	// started with — so the first prompt re-sets neither. Reading the same
	// `provider/id` / level strings the submit path compares against keeps the
	// two sides symmetric.
	const spawnFlagValue = (flag: string): string | undefined => {
		const index = input.metadata.args.indexOf(flag);
		return index >= 0 ? input.metadata.args[index + 1] : undefined;
	};
	let appliedModel: string | undefined = spawnFlagValue('--model');
	let appliedThinking: string | undefined = spawnFlagValue('--thinking');

	const emitRawFrame = (direction: 'rx' | 'tx', line: string): void => {
		if (!onRawFrame) {
			return;
		}
		try {
			onRawFrame({
				at: now().toISOString(),
				direction,
				label: input.metadata.label,
				line,
				sessionId: input.metadata.id,
			});
		} catch {
			// Debug tap must never break the hot path.
		}
	};

	const { emit, attachListener } = createListenerFanout({
		getMetadata: () => metadata,
		listeners,
	});

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
			env: buildSpawnEnv(baseEnv, metadata.env),
		});
	} catch (cause) {
		const detail = cause instanceof Error ? cause.message : String(cause);
		patchMetadata({ status: 'errored' }, { silent: true });
		return {
			publicSession: createSpawnFailureSession({
				detail,
				listeners,
				metadata,
				now,
			}),
		};
	}

	patchMetadata({ status: 'starting' });

	const pendingStatsIds = new Set<string>();
	// See `ProtocolDispatchDeps.streamedTurns` for the lifecycle/dedup rules.
	const streamedTurns = new Set<string>();

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
			emitRawFrame('tx', line.trimEnd());
		} catch {
			// stdin not writable (child gone/EPIPE) — drop the request and
			// release the pending id so it never leaks.
			pendingStatsIds.delete(id);
		}
	};

	const handleProtocolFrame = createProtocolDispatcher({
		emit,
		emitError,
		now,
		patchMetadata,
		pendingStatsIds,
		requestContextUsage,
		setStatus,
		streamedTurns,
	});

	const lineStream = createPiRpcLineStream({
		emitError,
		maxLineBytes,
		onFrame: handleProtocolFrame,
		onRawLine: (line) => emitRawFrame('rx', line),
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

	bindChildStreams({
		child,
		emit,
		emitError,
		finalizeShutdown,
		getPendingShutdownReason: () => pendingShutdownReason,
		killTimer,
		lineStream,
		now,
		stderrRing,
	});

	const sendSignal = (signal: NodeJS.Signals): void => {
		try {
			child.kill(signal);
		} catch {
			// Already exited.
		}
	};

	const writeFrame = async (frame: unknown): Promise<void> => {
		const line = `${JSON.stringify(frame)}\n`;
		// Once the Pi child exits its stdin pipe is no longer writable and a write
		// would throw (or asynchronously emit) EPIPE. Fail fast with a typed error
		// the IPC layer turns into a clean `{ error }` result instead of crashing.
		if (closed || !child.stdin.writable) {
			throw new Error('Pi RPC session is not writable.');
		}
		let writeResult: boolean;
		try {
			writeResult = child.stdin.write(line, 'utf8');
		} catch (cause) {
			throw new Error(
				`Pi RPC stdin write failed: ${cause instanceof Error ? cause.message : String(cause)}`,
			);
		}
		emitRawFrame('tx', line.trimEnd());
		if (!writeResult) {
			await awaitStdinDrain(child.stdin);
		}
	};

	const applyModelChange = async (
		modelOverride: string | undefined,
	): Promise<void> => {
		const next = modelOverride?.trim();
		if (!next || next === appliedModel) {
			return;
		}
		// `set_model` needs provider and id split out. Pi model ids follow the
		// `provider/id` shape; skip the command when no provider segment exists
		// rather than send a malformed frame the runtime would reject.
		const separator = next.indexOf('/');
		if (separator <= 0 || separator >= next.length - 1) {
			console.warn(
				'[pi-rpc] ignoring malformed model override; expected `provider/id`',
				{ modelOverride: next },
			);
			return;
		}
		await writeFrame({
			modelId: next.slice(separator + 1),
			provider: next.slice(0, separator),
			type: 'set_model',
		});
		appliedModel = next;
	};

	const applyThinkingChange = async (
		thinkingLevel: string | undefined,
	): Promise<void> => {
		const next = thinkingLevel?.trim();
		if (!next || next === appliedThinking) {
			return;
		}
		await writeFrame({ level: next, type: 'set_thinking_level' });
		appliedThinking = next;
	};

	const submit = async (
		request: PiAgentSubmitRequest,
	): Promise<PiAgentSubmitAcknowledgement> => {
		if (closed) {
			throw new Error('Pi RPC session is closed.');
		}
		const turnId = turnIdFactory();
		const acceptedAt = now().toISOString();
		// Mid-turn injection: Pi rejects a plain `prompt` while streaming, so emit
		// the dedicated `steer` / `follow_up` frame instead. These carry only a
		// message — no model/thinking change, no new turn — and the session stays
		// 'streaming', so we return before the prompt path below.
		if (request.streamingBehavior) {
			await writeFrame({
				message: request.prompt,
				type: request.streamingBehavior === 'steer' ? 'steer' : 'follow_up',
			});
			return { acceptedAt, turnId };
		}
		// Apply per-turn model/thinking changes before the prompt. Pi processes
		// stdin commands in order, so a `set_model`/`set_thinking_level` written
		// ahead of the prompt is guaranteed to take effect for that turn. The
		// `prompt` command itself carries no model field (Pi ignores unknown
		// keys), so model selection must travel through these commands.
		await applyModelChange(request.modelOverride);
		await applyThinkingChange(request.thinkingLevel);

		// Pi RPC protocol (@earendil-works/pi-coding-agent >= 0.79):
		//   {"type":"prompt","message":"<text>"}
		// `turnId` and attachments are Ensemblr-side metadata that the runtime
		// ignores today; we keep them on the frame so a future Pi build that
		// accepts them needs no client change.
		const frame = {
			attachments: request.attachments ?? [],
			message: request.prompt,
			turnId,
			type: 'prompt' as const,
		};
		await writeFrame(frame);
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
		killTimer.schedule(killGraceMs, () => sendSignal('SIGKILL'));
	};

	const close = async (): Promise<void> => {
		if (closed) {
			return;
		}
		pendingShutdownReason = pendingShutdownReason ?? 'manual';
		try {
			child.stdin.end();
		} catch {
			// stdin may already be closed (child exited before close() ran).
		}
		sendSignal('SIGTERM');
		killTimer.schedule(killGraceMs, () => sendSignal('SIGKILL'));
	};

	const publicSession: PiAgentAdapterSession = {
		abort,
		close,
		getMetadata: () => metadata,
		id: metadata.id,
		subscribe: attachListener,
		submit,
	};

	return { publicSession };
}
