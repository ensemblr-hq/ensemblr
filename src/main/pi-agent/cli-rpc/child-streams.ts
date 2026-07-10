import type { JsonlLineStream } from '../../pi-ipc/jsonl-line-stream.ts';
import type {
	PiAgentErrorCode,
	PiAgentEvent,
	PiAgentShutdownReason,
} from '../pi-agent-types.ts';
import type { KillTimer } from './kill-timer.ts';
import type { RingBuffer } from './ring-buffer.ts';
import type { ChildLike } from './spawn-env.ts';

/**
 * Wires the spawned Pi RPC child's stdio + lifecycle events into the adapter:
 *  - stdout → JSONL line stream (decoded by the protocol dispatcher elsewhere)
 *  - stderr → ring buffer (for post-mortem) + recoverable `error` event
 *  - stdin  → recoverable `error` event (absorbs async EPIPE so a dead pipe
 *             cannot become an uncaught exception that crashes the main process)
 *  - process `error` → typed `spawn-error`
 *  - process `exit`  → cancel kill timer, classify shutdown reason, finalize
 *
 * The `exit` classification preserves the original adapter behavior:
 *  - If `pendingShutdownReason` was set by `abort`/`close`, use it verbatim.
 *  - Otherwise: `code === 0` → `completed`, anything else → `crashed`.
 *  - On crash with a code, emit a code-tagged error (with signal in detail).
 *  - On crash from signal alone (code null), include the stderr ring snapshot
 *    in the error detail so the operator sees the last bytes before death.
 */
export function bindChildStreams({
	child,
	lineStream,
	stderrRing,
	killTimer,
	emit,
	emitError,
	getPendingShutdownReason,
	now,
	finalizeShutdown,
}: {
	child: ChildLike;
	lineStream: JsonlLineStream;
	stderrRing: RingBuffer;
	killTimer: KillTimer;
	emit: (event: PiAgentEvent) => void;
	emitError: (
		code: PiAgentErrorCode,
		message: string,
		detail?: string,
		recoverable?: boolean,
	) => void;
	getPendingShutdownReason: () => PiAgentShutdownReason | null;
	now: () => Date;
	finalizeShutdown: (reason: PiAgentShutdownReason) => void;
}): void {
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

	// The child's stdin is a pipe socket. If the Pi process exits mid-turn the
	// kernel reports EPIPE asynchronously on this stream; without a listener Node
	// rethrows it as an uncaught exception and crashes the main process. Absorb it
	// as a recoverable error so the renderer surfaces it and the `exit` handler
	// classifies the real shutdown reason.
	child.stdin.on('error', (cause: Error) => {
		emitError(
			'submit-failed',
			'Pi RPC stdin write failed.',
			cause.message,
			true,
		);
	});

	child.on('error', (cause: Error) => {
		emitError('spawn-error', 'Pi RPC process emitted an error.', cause.message);
	});

	child.on('exit', (code, signal) => {
		killTimer.clear();
		const pending = getPendingShutdownReason();
		const reason: PiAgentShutdownReason = pending
			? pending
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
}
