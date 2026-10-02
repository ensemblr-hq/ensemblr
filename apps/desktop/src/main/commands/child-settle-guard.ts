import type { ChildProcess } from 'node:child_process';

/**
 * How long a child that has stopped running is given to drain its pipes before
 * its result is assembled without waiting for them. Long enough that a normal
 * command's buffered tail always arrives first; short enough that a caller
 * never notices the difference.
 */
export const STREAM_DRAIN_GRACE_MS = 1_000;

/**
 * Forces a spawned child's promise to settle once a deadline elapses, whether
 * or not the child ever reports `'close'`.
 */
export interface ChildSettleGuard {
	/** Schedules the deadline, replacing any deadline already armed. */
	arm: (delayMs: number) => void;
	/** Cancels the pending deadline. */
	clear: () => void;
}

/**
 * Builds the deadline that keeps a `child_process` promise from hanging
 * forever.
 *
 * `'close'` fires only once every inherited stdio pipe has reached EOF, so a
 * grandchild that outlives the child holds it open indefinitely — an ssh
 * `ControlMaster`, a version-manager daemon started from a shell rc file, or
 * anything else a command backgrounds. `'exit'` reports the child itself, and
 * a child stuck in an uninterruptible syscall reports neither, so a timeout
 * that only signals the process is not a bound on anything. Callers arm this
 * alongside those signals and settle with whatever output has arrived.
 * @param settle - Assembles and resolves the caller's result; must be idempotent
 * @returns A guard whose `arm` schedules the forced settle and whose `clear` cancels it
 */
export function createChildSettleGuard(settle: () => void): ChildSettleGuard {
	let deadline: ReturnType<typeof setTimeout> | null = null;

	const clear = (): void => {
		if (deadline) {
			clearTimeout(deadline);
			deadline = null;
		}
	};

	return {
		arm: (delayMs) => {
			clear();
			deadline = setTimeout(() => {
				deadline = null;
				settle();
			}, delayMs);
		},
		clear,
	};
}

/**
 * Wires a spawned child's `'exit'` and `'close'` events into its settle guard:
 * `'exit'` records the outcome and starts the drain grace, `'close'` records it
 * and settles immediately with everything drained.
 * @param options - The child to watch, its guard, and the caller's callbacks
 */
export function wireChildSettlement(options: {
	child: ChildProcess;
	guard: ChildSettleGuard;
	record: (exitCode: number | null, signal: NodeJS.Signals | null) => void;
	settle: () => void;
}): void {
	const { child, guard, record, settle } = options;

	child.on('exit', (exitCode, signal) => {
		record(exitCode, signal);
		guard.arm(STREAM_DRAIN_GRACE_MS);
	});
	child.on('close', (exitCode, signal) => {
		record(exitCode, signal);
		settle();
	});
}
