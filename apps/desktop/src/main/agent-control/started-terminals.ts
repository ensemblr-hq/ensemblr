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
 * Hard ceiling on remembered starts, kept only as a backstop against a workspace
 * that is never listed again — an archived one, say, whose records nothing will
 * ever prune. {@link StartedTerminalRegistry.countOpen} drops a workspace's dead
 * records every time it reads that workspace, so in an app that keeps starting
 * terminals the map tracks live ones and this never bites. It matters that it
 * never bites: evicting a *live* terminal's record would both refuse its owner
 * the close and silently hand the tree a free slot.
 */
export const MAX_TRACKED_TERMINALS = 512;

/** Who started one terminal, and where — the tree, the session, the workspace. */
interface TerminalOwner {
	rootSessionId: string;
	sessionId: string;
	workspaceId: string;
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
	 * budget an open-terminal cap is read against, and — in the same pass — drops
	 * the records of that workspace's terminals the listing no longer reports.
	 *
	 * Counting and pruning are one operation because they read the same evidence:
	 * the live listing is the only thing that knows a terminal is gone, since a
	 * user closing a tab tells this registry nothing. Pruning is confined to the
	 * workspace being read for exactly that reason — another workspace's records
	 * are not absent, they are simply out of frame.
	 */
	countOpen: (input: {
		openTerminalIds: ReadonlySet<string>;
		rootSessionId: string;
		workspaceId: string;
	}) => number;
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
		record: ({ rootSessionId, sessionId, terminalId, workspaceId }) => {
			startedBy.set(terminalId, { rootSessionId, sessionId, workspaceId });
			evictOldest();
		},
		wasStartedBy: (sessionId, terminalId) =>
			startedBy.get(terminalId)?.sessionId === sessionId,
		forget: (terminalId) => {
			startedBy.delete(terminalId);
		},
		countOpen: ({ openTerminalIds, rootSessionId, workspaceId }) => {
			let open = 0;
			for (const [terminalId, owner] of startedBy) {
				if (owner.workspaceId !== workspaceId) {
					continue;
				}
				if (!openTerminalIds.has(terminalId)) {
					startedBy.delete(terminalId);
					continue;
				}
				if (owner.rootSessionId === rootSessionId) {
					open += 1;
				}
			}
			return open;
		},
	};
}
