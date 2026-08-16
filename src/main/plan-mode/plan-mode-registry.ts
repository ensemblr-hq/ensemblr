/**
 * Which agent sessions are currently in Plan Mode. In-memory only: the renderer's
 * per-chat `atomWithStorage` toggle is the durable source and re-sends
 * `planMode` on every open and submit, so a restart rebuilds this map from the
 * next prompt rather than from a database migration.
 *
 * It also tracks which of those sessions already have a plan awaiting a
 * decision, which is what makes the next turn a refinement round rather than a
 * fresh one. That flag survives the re-sent `planMode: true` on every submit —
 * only turning Plan Mode off, which is what Approve and Hand off do, clears it.
 * Hand off submits no prompt to carry the new toggle, so it states it over
 * `setAgentPlanMode` instead.
 */

/** Public surface of the plan-mode registry. */
export interface PlanModeRegistry {
	/** Turns Plan Mode on or off for a session; `false` drops the entry. */
	setActive: (agentSessionId: string, active: boolean) => void;
	/** Whether a session is planning. Unknown sessions are not. */
	isActive: (agentSessionId: string) => boolean;
	/**
	 * Records that the session has handed a plan to the user. Ignored for a
	 * session that is not planning, so the flag is always a sub-state of Plan
	 * Mode and cannot outlive the toggle that framed it.
	 */
	markSubmitted: (agentSessionId: string) => void;
	/** Whether a plan is already in front of the user, awaiting their decision. */
	hasSubmittedPlan: (agentSessionId: string) => boolean;
	/** Forgets a session that ended, keeping the map bounded. */
	release: (agentSessionId: string) => void;
}

/**
 * Creates the plan-mode registry.
 * @returns The registry the IPC layer writes and the control layer reads.
 */
export function createPlanModeRegistry(): PlanModeRegistry {
	const planning = new Set<string>();
	const submitted = new Set<string>();

	return {
		/** Adds or removes the session from the planning set. */
		setActive: (agentSessionId, active) => {
			if (active) {
				planning.add(agentSessionId);
				return;
			}
			planning.delete(agentSessionId);
			submitted.delete(agentSessionId);
		},
		/** Reports whether the session is planning. */
		isActive: (agentSessionId) => planning.has(agentSessionId),
		/** Records a plan handed over by a session that is still planning. */
		markSubmitted: (agentSessionId) => {
			if (!planning.has(agentSessionId)) {
				return;
			}
			submitted.add(agentSessionId);
		},
		/** Reports whether the session already has a plan under review. */
		hasSubmittedPlan: (agentSessionId) => submitted.has(agentSessionId),
		/** Drops the session's entry. */
		release: (agentSessionId) => {
			planning.delete(agentSessionId);
			submitted.delete(agentSessionId);
		},
	};
}
