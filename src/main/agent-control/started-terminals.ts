/**
 * Which agent session started which dock terminal, so `stopTerminal` can refuse
 * a `close` on a terminal the caller did not open, and so the open-terminal
 * budget can be counted over the delegation tree that spent it. Closing discards
 * the scrollback irrecoverably, and the workspace scope check cannot tell an
 * agent's own spawn terminal from the one the user is working in — both live in
 * the same workspace. Nothing else needs this, so it is a control-layer record
 * rather than a field on the terminal session itself.
 */

/**
 * How many starts the registry remembers. A start is recorded per terminal
 * rather than per live session, so the map would otherwise grow for the life of
 * the app; the oldest entry is evicted past this, costing at worst a refused
 * close on a terminal opened thousands of terminals ago.
 */
export const MAX_TRACKED_TERMINALS = 512;

/** Who started one terminal: the session itself, and the tree it belongs to. */
interface TerminalOwner {
	rootSessionId: string;
	sessionId: string;
}

/** Ownership record consumed by the agent-control service. */
export interface StartedTerminalRegistry {
	/** Remember which session, in which delegation tree, started `terminalId`. */
	record: (owner: TerminalOwner & { terminalId: string }) => void;
	/** Whether `sessionId` is the session that started `terminalId`. */
	wasStartedBy: (sessionId: string, terminalId: string) => boolean;
	/** Drop a terminal's record once its tab is gone. */
	forget: (terminalId: string) => void;
	/**
	 * How many of `openTerminalIds` this delegation tree started, which is the
	 * budget an open-terminal cap is read against. Derived from the live listing
	 * rather than from a counter this registry maintains, so a terminal the user
	 * closed behind the app's back stops counting without anything telling us.
	 */
	countOpen: (
		rootSessionId: string,
		openTerminalIds: ReadonlySet<string>,
	) => number;
}

/**
 * Builds the {@link StartedTerminalRegistry} over an insertion-ordered map,
 * which is what makes the eviction policy a single delete of the oldest key.
 * @returns A registry with mutable, bounded per-terminal ownership records.
 */
export function createStartedTerminalRegistry(): StartedTerminalRegistry {
	const startedBy = new Map<string, TerminalOwner>();

	/**
	 * Drops the oldest records until the map is back inside its cap.
	 * `Map.set` leaves an existing key in place, so insertion order is start
	 * order and the first key is always the oldest.
	 */
	const evictOldest = (): void => {
		while (startedBy.size > MAX_TRACKED_TERMINALS) {
			const oldest = startedBy.keys().next();
			if (oldest.done) {
				return;
			}
			startedBy.delete(oldest.value);
		}
	};

	return {
		record: ({ rootSessionId, sessionId, terminalId }) => {
			startedBy.set(terminalId, { rootSessionId, sessionId });
			evictOldest();
		},
		wasStartedBy: (sessionId, terminalId) =>
			startedBy.get(terminalId)?.sessionId === sessionId,
		forget: (terminalId) => {
			startedBy.delete(terminalId);
		},
		countOpen: (rootSessionId, openTerminalIds) => {
			let open = 0;
			for (const terminalId of openTerminalIds) {
				if (startedBy.get(terminalId)?.rootSessionId === rootSessionId) {
					open += 1;
				}
			}
			return open;
		},
	};
}
