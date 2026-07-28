/**
 * Which Pi sessions are currently in Plan Mode. In-memory only: the renderer's
 * per-chat `atomWithStorage` toggle is the durable source and re-sends
 * `planMode` on every open and submit, so a restart rebuilds this map from the
 * next prompt rather than from a database migration.
 */

/** Public surface of the plan-mode registry. */
export interface PlanModeRegistry {
	/** Turns Plan Mode on or off for a session; `false` drops the entry. */
	setActive: (piSessionId: string, active: boolean) => void;
	/** Whether a session is planning. Unknown sessions are not. */
	isActive: (piSessionId: string) => boolean;
	/** Forgets a session that ended, keeping the map bounded. */
	release: (piSessionId: string) => void;
}

/**
 * Creates the plan-mode registry.
 * @returns The registry the IPC layer writes and the control layer reads.
 */
export function createPlanModeRegistry(): PlanModeRegistry {
	const planning = new Set<string>();

	return {
		/** Adds or removes the session from the planning set. */
		setActive: (piSessionId, active) => {
			if (active) {
				planning.add(piSessionId);
				return;
			}
			planning.delete(piSessionId);
		},
		/** Reports whether the session is planning. */
		isActive: (piSessionId) => planning.has(piSessionId),
		/** Drops the session's entry. */
		release: (piSessionId) => {
			planning.delete(piSessionId);
		},
	};
}
