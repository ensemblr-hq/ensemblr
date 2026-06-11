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

	const openSessions = new Set<CliRpcSession>();

	const adapter: PiAgentAdapter = {
		createSession: async (input) => {
			const session = createCliRpcSession({
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

interface CliRpcSession {
	publicSession: PiAgentAdapterSession;
}

function createCliRpcSession({
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
			env: buildSpawnEnv(metadata.env),
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
		emitRawFrame('tx', line.trimEnd());
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
