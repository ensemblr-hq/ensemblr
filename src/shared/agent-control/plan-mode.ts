/**
 * Renders the `exitPlanMode` tool result. The call is deliberately one-way: it
 * hands the plan to the app and tells the agent to stop, so the plan stays the
 * last message the user sees while they decide. The decision comes back as the
 * agent's next prompt, so this result only has to make stopping unambiguous.
 */
import type { ExitPlanModeResult } from './contracts.ts';

/**
 * Builds the result an agent receives after submitting a plan for review.
 * @param planPath - Workspace-relative path of the saved plan, or null when the
 *   write failed.
 * @returns The result the control op resolves to.
 */
export function buildPlanSubmittedResult(
	planPath: string | null,
): ExitPlanModeResult {
	const saved = planPath
		? `The plan is saved at \`${planPath}\`.`
		: 'The plan could not be saved to a file, but the user can still read it in your message.';
	return {
		planPath,
		summary: `${saved} The user is now reviewing it. Your turn ends here — stop, and produce no further output. Do not summarise the plan again, do not ask whether it looks good, and do not start implementing. Whatever the user decides arrives as your next prompt.`,
	};
}
