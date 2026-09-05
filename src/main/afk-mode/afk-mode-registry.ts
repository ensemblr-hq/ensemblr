/**
 * Which agent sessions the user has stepped away from. In-memory only, for the
 * same reason `PlanModeRegistry` is: the renderer's per-chat `atomWithStorage`
 * toggle is the durable record and re-sends `afkMode` on every open and submit,
 * so a restart rebuilds this map from the next prompt rather than from a
 * database migration.
 *
 * Simpler than its Plan Mode counterpart because AFK has no sub-state to track.
 * Plan Mode carries "a plan is already in front of the user", which is what
 * makes the next turn a refinement round; nothing about being away has a second
 * phase.
 */

/** Public surface of the AFK registry. */
export interface AfkModeRegistry {
	/** Turns AFK on or off for a session; `false` drops the entry. */
	setActive: (agentSessionId: string, active: boolean) => void;
	/** Whether the user is away from a session. Unknown sessions are not. */
	isActive: (agentSessionId: string) => boolean;
	/**
	 * Puts a freshly spawned child into AFK, so an unattended agent's delegation
	 * does not open a questionnaire in a tab nobody is watching. One-way for the
	 * reason `PlanModePort.activateForSpawn` is: this is reachable from every
	 * control handler, and a member that could turn AFK *off* would let an op
	 * unblock its own session.
	 */
	activateForSpawn: (agentSessionId: string) => void;
	/** Forgets a session that ended, keeping the map bounded. */
	release: (agentSessionId: string) => void;
}

/**
 * Creates the AFK registry.
 * @returns The registry the IPC layer writes and the control layer reads.
 */
export function createAfkModeRegistry(): AfkModeRegistry {
	const unattended = new Set<string>();

	return {
		/** Adds or removes the session from the unattended set. */
		setActive: (agentSessionId, active) => {
			if (active) {
				unattended.add(agentSessionId);
				return;
			}
			unattended.delete(agentSessionId);
		},
		/** Reports whether the user is away from the session. */
		isActive: (agentSessionId) => unattended.has(agentSessionId),
		/** Marks a spawned child unattended, never the reverse. */
		activateForSpawn: (agentSessionId) => {
			unattended.add(agentSessionId);
		},
		/** Drops the session's entry. */
		release: (agentSessionId) => {
			unattended.delete(agentSessionId);
		},
	};
}
