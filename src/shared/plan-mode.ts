/**
 * Public entrypoint for Plan Mode's enforcement policy. Import the bash and
 * tool classifiers from here rather than the `plan-mode/` implementation files.
 *
 * Policy lives in `shared/` and is reached over the agent-control server: the
 * shipped Pi extension cannot import from `src/` at runtime, so it asks the app
 * per intercepted tool call instead of carrying a second copy of a
 * security-sensitive classifier that a parity test would have to police.
 *
 * The Concierge guard rides the same channel for the same reason. It is the
 * mirror of Plan Mode's: Plan Mode blocks every file write until a plan is
 * approved, the Concierge blocks every file write outside its own folder,
 * permanently. Both share the bash classifier, because "read-only shell" means
 * the same thing to both.
 */
export type { BashGuardVerdict } from './plan-mode/bash-guard.ts';
export { isReadOnlyBashCommand } from './plan-mode/bash-guard.ts';
export type {
	ConciergeToolRequest,
	ConciergeToolVerdict,
} from './plan-mode/concierge-guard.ts';
export {
	CONCIERGE_GUARDED_TOOLS,
	CONCIERGE_SHELL_TOOLS,
	CONCIERGE_WRITE_TOOLS,
	evaluateConciergeTool,
	pathStaysInConciergeHome,
} from './plan-mode/concierge-guard.ts';
export {
	PLAN_MODE_CONDITIONAL_OPS,
	planModeControlOpDenial,
	planModeFollowUpDenial,
} from './plan-mode/control-ops.ts';
export type { LexedCommand } from './plan-mode/shell-lexer.ts';
export { lexCommand } from './plan-mode/shell-lexer.ts';
export type {
	PlanModeToolRequest,
	PlanModeToolVerdict,
} from './plan-mode/tool-guard.ts';
export {
	evaluatePlanModeTool,
	PLAN_MODE_GUARDED_TOOLS,
} from './plan-mode/tool-guard.ts';
