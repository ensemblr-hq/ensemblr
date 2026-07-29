/** Signals that mean the Pi process was asked to stop, not that it broke. */
const GRACEFUL_TERMINATION_SIGNALS: ReadonlySet<string> = new Set([
	'SIGHUP',
	'SIGINT',
	'SIGTERM',
]);

/**
 * Exit codes a shell or CLI wrapper reports for "died from signal N" (128 + N).
 * Pi's launcher re-reports SIGTERM as 143 when the app quits, so an exit with
 * one of these codes is a teardown the user requested, not a failure.
 */
const GRACEFUL_TERMINATION_EXIT_CODES: ReadonlySet<number> = new Set([
	129, 130, 143,
]);

/**
 * Reports whether a Pi child's exit was a requested stop rather than a failure,
 * so shutdown noise never reaches the timeline. SIGKILL is deliberately absent:
 * a force-kill the adapter did not schedule (an OOM kill, say) is a real crash.
 * @param code - Exit code reported by the child, or null when a signal killed it
 * @param signal - Signal that killed the child, or null when it exited normally
 * @returns True when the exit needs no operator-facing diagnostic
 */
export function isGracefulTermination(
	code: number | null,
	signal: string | null,
): boolean {
	if (signal !== null) {
		return GRACEFUL_TERMINATION_SIGNALS.has(signal);
	}
	return code === null || GRACEFUL_TERMINATION_EXIT_CODES.has(code);
}

const EXIT_CODE_MESSAGE = /\bexited with code (\d+)\b/;
const EXIT_SIGNAL_MESSAGE = /\bkilled by signal (SIG[A-Z0-9]+)\b/;

/**
 * Recognizes a persisted process-exit diagnostic that describes a requested
 * stop, reading the code or signal back out of the message text.
 *
 * Sessions recorded before graceful exits stopped being reported still hold
 * those rows and replay them on every load, and their persisted `recoverable`
 * flag mislabels them as fatal — the message is the only surviving evidence of
 * how the process actually died.
 * @param message - The persisted error message to classify
 * @returns True when the message describes a graceful termination
 */
export function describesGracefulTermination(message: string): boolean {
	const exitCode = EXIT_CODE_MESSAGE.exec(message)?.[1];
	if (exitCode) {
		return isGracefulTermination(Number.parseInt(exitCode, 10), null);
	}
	const exitSignal = EXIT_SIGNAL_MESSAGE.exec(message)?.[1];
	if (exitSignal) {
		return isGracefulTermination(null, exitSignal);
	}
	return false;
}
