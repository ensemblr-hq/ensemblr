/**
 * The sentence every Plan Mode denial ends with. Kept in its own module so the
 * tool classifier and the control-op gate hand the model the same way out,
 * rather than two near-identical strings that drift apart.
 */

/**
 * Closing line on every block reason. The model is not stuck: it can end plan
 * mode the intended way instead of hunting for a tool that slips through.
 */
const ESCAPE_HATCH =
	'This is not a bug to work around: finish the plan and call `ensemblr_exit_plan_mode`. If the user approves it, Plan Mode turns off and you can implement it.';

/**
 * Builds the model-facing block reason from the specific cause.
 * @param cause - What about this call is not allowed while planning.
 * @returns The full reason, escape hatch included.
 */
export function planModeBlockReason(cause: string): string {
	return `Plan Mode is on — ${cause}. ${ESCAPE_HATCH}`;
}
