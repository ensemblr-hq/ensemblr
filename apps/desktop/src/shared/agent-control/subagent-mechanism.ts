/**
 * The delegation-mechanism vocabulary, held in a leaf module rather than beside
 * the playbook prose that consumes it. `config.ts` and the settings picker both
 * need the runtime list, and neither should pull several hundred lines of
 * system-prompt strings into its module graph to get it.
 */

/** Every delegation mechanism a session may open under, in picker order. */
export const SUBAGENT_MECHANISMS = ['ensemblr', 'native'] as const;

/**
 * Which delegation mechanism a caller was opened with. `ensemblr` spawns visible
 * chat tabs through the control tools; `native` leaves delegation to the
 * runtime's own sub-agent tool and withholds the spawn ops so the two cannot
 * both be live in one session. Resolved once at session open — a runtime that
 * fixes its tool list there cannot be re-gated mid-session, and a caller left
 * holding the playbook for one mechanism and the tools for the other could
 * delegate by neither.
 */
export type SubagentMechanism = (typeof SUBAGENT_MECHANISMS)[number];

/**
 * Narrows an unknown value to a delegation mechanism, for the settings picker
 * and anything else reading one off an untyped boundary.
 * @param value - Candidate value to check.
 * @returns Whether the value names a mechanism.
 */
export function isSubagentMechanism(
	value: unknown,
): value is SubagentMechanism {
	return (
		typeof value === 'string' &&
		SUBAGENT_MECHANISMS.includes(value as SubagentMechanism)
	);
}
