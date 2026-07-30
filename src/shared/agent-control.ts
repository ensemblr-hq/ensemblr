/**
 * Public entrypoint for the agent → app control contract. Import op identifiers,
 * argument/result types, and the argument validators from here rather than the
 * `agent-control/` implementation files.
 */
export { buildAskUserQuestionResult } from './agent-control/ask-user-question.ts';
export type { AgentControlRole } from './agent-control/awareness.ts';
export {
	HARNESS_AWARENESS,
	ORCHESTRATOR_AWARENESS,
	PLAN_MODE_ORCHESTRATOR_AWARENESS,
	PLAN_MODE_SUBAGENT_AWARENESS,
	resolveAgentRole,
	roleForDepth,
	SUBAGENT_AWARENESS,
} from './agent-control/awareness.ts';
export {
	BRIEF_REPORT_CHARS,
	briefReport,
} from './agent-control/brief-report.ts';
export * from './agent-control/contracts.ts';
export { buildPlanSubmittedResult } from './agent-control/plan-mode.ts';
export * from './agent-control/schemas.ts';
export {
	buildSessionBriefNudge,
	SESSION_BRIEF_NUDGE_HEADER,
} from './agent-control/session-brief.ts';
export {
	SUBAGENT_UNUSABLE_OPS,
	SUBAGENT_WITHHELD_OPS,
	subAgentControlOpDenial,
} from './agent-control/subagent-policy.ts';
