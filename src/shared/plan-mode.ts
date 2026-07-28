/**
 * Public entrypoint for Plan Mode's enforcement policy. Import the bash and
 * tool classifiers from here rather than the `plan-mode/` implementation files.
 *
 * Policy lives in `shared/` and is reached over the agent-control server: the
 * shipped Pi extension cannot import from `src/` at runtime, so it asks the app
 * per intercepted tool call instead of carrying a second copy of a
 * security-sensitive classifier that a parity test would have to police.
 */
export type { BashGuardVerdict } from './plan-mode/bash-guard.ts';
export { isReadOnlyBashCommand } from './plan-mode/bash-guard.ts';
export { planModeControlOpDenial } from './plan-mode/control-ops.ts';
export type {
	PlanModeToolRequest,
	PlanModeToolVerdict,
} from './plan-mode/tool-guard.ts';
export { evaluatePlanModeTool } from './plan-mode/tool-guard.ts';
