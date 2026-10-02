/** How long a run stays open collecting deltas before it is broadcast. */
const FLUSH_WINDOW_MS = 32;

/** Position a run holds in its branch's ordinal space, reserved when the run opens. */
export interface DeltaSlot {
	id: string;
	ordinal: number;
}

/** One streaming text or reasoning delta as the runtime reported it. */
export interface StreamingDelta {
	at: string;
	branchId: string;
	kind: 'reasoning-delta' | 'text-delta';
	parentToolCallId?: string;
	role: 'agent' | 'tool' | 'user';
	sessionId: string;
	text: string;
	turnId: string | null;
	workspaceId: string;
}

/**
 * Adjacent compatible deltas folded into one broadcast. Every field but `text`
 * and `slot` is the first delta's, and `text` is the exact concatenation.
 */
export interface DeltaRun extends StreamingDelta {
	slot: DeltaSlot;
}

/** A run still collecting deltas, and the timer that will broadcast it. */
interface OpenRun {
	run: DeltaRun;
	timer: ReturnType<typeof setTimeout>;
}

/** Public surface of {@link createDeltaCoalescer}. */
interface DeltaCoalescer {
	/** Broadcasts a session's open run now, if it has one. */
	flush: (sessionId: string) => void;
	/**
	 * Adds a delta to its session's open run, opening a run when it cannot join
	 * one. `reserveSlot` is called only when a run opens.
	 */
	push: (delta: StreamingDelta, reserveSlot: () => DeltaSlot) => void;
}

/**
 * Whether a delta continues a run: the same stream, in the same place, in the
 * same order, so that folding it in cannot move it past anything.
 * @param run - The run currently collecting deltas
 * @param delta - The delta that just arrived for the run's session
 * @returns True when the delta may join the run
 */
function continuesRun(run: DeltaRun, delta: StreamingDelta): boolean {
	return (
		run.branchId === delta.branchId &&
		run.kind === delta.kind &&
		run.parentToolCallId === delta.parentToolCallId &&
		run.role === delta.role &&
		run.turnId === delta.turnId
	);
}

/**
 * Folds a session's streaming deltas into one broadcast per flush window.
 *
 * A runtime reports one delta per token, and broadcasting each is a structured
 * clone, an IPC message, and a renderer cache write per token. Adjacent deltas
 * that belong to the same stream are held for a short window and sent as a
 * single run whose text is their exact concatenation.
 *
 * A run is closed before it is emitted, so a run is never sent twice. `emit`
 * must not throw: a run whose window closed is emitted from a timer, which has
 * no caller to hand the failure to.
 * @param options - `emit` receives each finished run, in the order runs opened.
 * @returns The coalescer's push and flush surface.
 */
export function createDeltaCoalescer({
	emit,
}: {
	emit: (run: DeltaRun) => void;
}): DeltaCoalescer {
	const openRuns = new Map<string, OpenRun>();

	/**
	 * Broadcasts a session's open run now and clears it.
	 * @param sessionId - Session whose run to broadcast
	 */
	const flush = (sessionId: string): void => {
		const open = openRuns.get(sessionId);
		if (!open) {
			return;
		}
		clearTimeout(open.timer);
		openRuns.delete(sessionId);
		emit(open.run);
	};

	/**
	 * Adds a delta to its session's open run, or closes that run and opens a new
	 * one when the delta cannot join it.
	 * @param delta - The delta the runtime just reported
	 * @param reserveSlot - Reserves the slot of a run, called only when one opens
	 */
	const push = (delta: StreamingDelta, reserveSlot: () => DeltaSlot): void => {
		const open = openRuns.get(delta.sessionId);
		if (open && continuesRun(open.run, delta)) {
			openRuns.set(delta.sessionId, {
				...open,
				run: { ...open.run, text: open.run.text + delta.text },
			});
			return;
		}
		flush(delta.sessionId);
		openRuns.set(delta.sessionId, {
			run: { ...delta, slot: reserveSlot() },
			timer: setTimeout(() => flush(delta.sessionId), FLUSH_WINDOW_MS),
		});
	};

	return { flush, push };
}
