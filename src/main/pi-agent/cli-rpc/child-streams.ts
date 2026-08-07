import { isGracefulTermination } from '../../../shared/process-exit.ts';
import type {
	AgentErrorCode,
	AgentEvent,
	AgentShutdownReason,
} from '../../agent-runtime/agent-types.ts';
import type { JsonlLineStream } from '../../pi-ipc';
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
 * The `exit` classification:
 *  - If `pendingShutdownReason` was set by `abort`/`close`, use it verbatim.
 *  - Otherwise: `code === 0` → `completed`, anything else → `crashed`.
 *  - A crash caused by a graceful termination signal is silent — the process
 *    was asked to stop, so there is nothing for the operator to act on.
 *  - Any other crash emits a fatal error carrying the signal and the stderr
 *    ring snapshot, the last bytes the child printed before it died.
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
	emit: (event: AgentEvent) => void;
	emitError: (
		code: AgentErrorCode,
		message: string,
		detail?: string,
		recoverable?: boolean,
	) => void;
	getPendingShutdownReason: () => AgentShutdownReason | null;
	now: () => Date;
	finalizeShutdown: (reason: AgentShutdownReason) => void;
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
		const reason = classifyExit(code, getPendingShutdownReason());
		if (reason === 'crashed' && !isGracefulTermination(code, signal)) {
			emitError(
				'adapter-failure',
				crashMessage(code, signal),
				crashDetail(signal, stderrRing),
			);
		}
		finalizeShutdown(reason);
	});
}

/**
 * Classifies why the child exited: a reason `abort`/`close` already recorded
 * wins, otherwise a zero code is a clean finish and anything else is a crash.
 * @param code - Exit code reported by the child, or null when a signal killed it
 * @param pending - Shutdown reason recorded by `abort`/`close`, or null when neither ran
 * @returns The shutdown reason to finalize the session with
 */
function classifyExit(
	code: number | null,
	pending: AgentShutdownReason | null,
): AgentShutdownReason {
	if (pending) {
		return pending;
	}
	return code === 0 ? 'completed' : 'crashed';
}

/**
 * Phrases the crash headline around whatever the OS reported — an exit code or,
 * when the child never got to set one, the signal that killed it.
 * @param code - Exit code reported by the child, or null when a signal killed it
 * @param signal - Signal that killed the child, or null when it exited normally
 * @returns The operator-facing crash message
 */
function crashMessage(
	code: number | null,
	signal: NodeJS.Signals | null,
): string {
	return code === null
		? `Pi RPC process killed by signal ${signal}.`
		: `Pi RPC process exited with code ${code}.`;
}

/**
 * Builds the detail for a crash diagnostic from the terminating signal and the
 * tail of stderr. The stderr tail is load-bearing: routine stderr chunks are no
 * longer surfaced in the timeline, so this is the only in-app view of what the
 * child printed before dying.
 * @param signal - Signal that killed the child, or null when it exited normally
 * @param stderrRing - Ring buffer holding the most recent stderr bytes
 * @returns The joined detail text, or undefined when there is nothing to report
 */
function crashDetail(
	signal: NodeJS.Signals | null,
	stderrRing: RingBuffer,
): string | undefined {
	const tail = stderrRing.snapshot().trim();
	const lines = [signal ? `signal=${signal}` : '', tail].filter(
		(line) => line.length > 0,
	);
	return lines.length > 0 ? lines.join('\n') : undefined;
}
