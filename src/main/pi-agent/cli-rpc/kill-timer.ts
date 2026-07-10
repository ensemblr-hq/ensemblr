/**
 * Tiny state machine wrapping the SIGINT/SIGTERM → SIGKILL escalation timer
 * the CLI RPC adapter uses on `abort` and `close`.
 *
 * Behavior: only one timer can be live at a time. Scheduling a new one
 * supersedes the previous one (which is what the adapter wants — `close`
 * after `abort` should re-arm with SIGKILL not stack two timers).
 *
 * Internal to the CLI RPC adapter.
 */
export interface KillTimer {
	/** Schedule `onExpire` after `graceMs`. Replaces any pending timer. */
	schedule: (graceMs: number, onExpire: () => void) => void;
	/** Cancel a pending timer; no-op when none is scheduled. */
	clear: () => void;
}

/**
 * Create a single-shot kill-escalation timer where scheduling a new timer
 * supersedes any pending one.
 * @returns A timer exposing `schedule` and `clear` controls.
 */
export function createKillTimer(): KillTimer {
	let handle: NodeJS.Timeout | null = null;

	const clear = (): void => {
		if (handle) {
			clearTimeout(handle);
			handle = null;
		}
	};

	return {
		clear,
		schedule: (graceMs, onExpire) => {
			clear();
			handle = setTimeout(() => {
				handle = null;
				onExpire();
			}, graceMs);
		},
	};
}
