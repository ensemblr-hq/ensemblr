/**
 * The delegation-initiative vocabulary, held in a leaf module for the reason
 * {@link SUBAGENT_MECHANISMS} is: `config.ts` and the settings picker both need
 * the value list, and neither should pull several hundred lines of system-prompt
 * strings into its module graph to get it.
 */

/** Every delegation initiative a user may choose, in picker order. */
export const DELEGATION_INITIATIVES = ['automatic', 'on-request'] as const;

/**
 * Whether an orchestrator may decide to delegate on its own. `automatic` leaves
 * the judgement with the agent, as its role playbook describes it; `on-request`
 * holds the work in the conversation until the user asks for a hand-off in so
 * many words. It steers prose rather than tool access — nothing in a control
 * call distinguishes a spawn the user asked for from one the agent chose, so a
 * gate here would refuse both.
 */
export type DelegationInitiative = (typeof DELEGATION_INITIATIVES)[number];

/**
 * Narrows an unknown value to a delegation initiative, for the settings picker
 * and anything else reading one off an untyped boundary.
 * @param value - Candidate value to check.
 * @returns Whether the value names an initiative.
 */
export function isDelegationInitiative(
	value: unknown,
): value is DelegationInitiative {
	return (
		typeof value === 'string' &&
		DELEGATION_INITIATIVES.includes(value as DelegationInitiative)
	);
}
