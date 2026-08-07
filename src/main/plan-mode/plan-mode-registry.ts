/**
 * Which agent sessions are currently in Plan Mode. In-memory only: the renderer's
 * per-chat `atomWithStorage` toggle is the durable source and re-sends
 * `planMode` on every open and submit, so a restart rebuilds this map from the
 * next prompt rather than from a database migration.
 */

/** Public surface of the plan-mode registry. */
export interface PlanModeRegistry {
	/** Turns Plan Mode on or off for a session; `false` drops the entry. */
	setActive: (agentSessionId: string, active: boolean) => void;
	/** Whether a session is planning. Unknown sessions are not. */
	isActive: (agentSessionId: string) => boolean;
	/** Forgets a session that ended, keeping the map bounded. */
	release: (agentSessionId: string) => void;
}

/**
 * Creates the plan-mode registry.
 * @returns The registry the IPC layer writes and the control layer reads.
 */
export function createPlanModeRegistry(): PlanModeRegistry {
	const planning = new Set<string>();

	return {
		/** Adds or removes the session from the planning set. */
		setActive: (agentSessionId, active) => {
			if (active) {
				planning.add(agentSessionId);
				return;
			}
			planning.delete(agentSessionId);
		},
		/** Reports whether the session is planning. */
		isActive: (agentSessionId) => planning.has(agentSessionId),
		/** Drops the session's entry. */
		release: (agentSessionId) => {
			planning.delete(agentSessionId);
		},
	};
}
