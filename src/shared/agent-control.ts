/**
 * Public entrypoint for the agent → app control contract. Import op identifiers,
 * argument/result types, and the argument validators from here rather than the
 * `agent-control/` implementation files.
 */
export {
	AGENT_CONTROL_ARG_ALIASES,
	CANONICAL_ARG_KEYS,
	canonicalizeArgs,
} from './agent-control/arg-naming.ts';
export { buildAskUserQuestionResult } from './agent-control/ask-user-question.ts';
export type {
	AgentControlRole,
	ControlAudience,
} from './agent-control/awareness.ts';
export {
	awarenessForAudience,
	CONCIERGE_AWARENESS,
	HARNESS_AWARENESS,
	NATIVE_ORCHESTRATOR_AWARENESS,
	ORCHESTRATOR_AWARENESS,
	PLAN_MODE_ORCHESTRATOR_AWARENESS,
	PLAN_MODE_SUBAGENT_AWARENESS,
	resolveAgentRole,
	roleForDepth,
	SUBAGENT_AWARENESS,
	spawnedChildRole,
} from './agent-control/awareness.ts';
export {
	BRIEF_REPORT_CHARS,
	briefReport,
} from './agent-control/brief-report.ts';
export * from './agent-control/contracts.ts';
export { buildConversationTranscript } from './agent-control/conversation-transcript.ts';
export { buildLanguageDirective } from './agent-control/language-directive.ts';
export {
	buildLinkedIssueDirective,
	LINKED_ISSUE_DIRECTIVE_HEADER,
} from './agent-control/linked-issue-directive.ts';
export { buildPlanSubmittedResult } from './agent-control/plan-mode.ts';
export * from './agent-control/schemas.ts';
export {
	buildSessionBriefNudge,
	PLAN_REFINEMENT_DIRECTIVE,
	PLAN_REFINEMENT_HEADER,
	SESSION_BRIEF_NUDGE_HEADER,
} from './agent-control/session-brief.ts';
export type { SubagentMechanism } from './agent-control/subagent-mechanism.ts';
export {
	isSubagentMechanism,
	SUBAGENT_MECHANISMS,
} from './agent-control/subagent-mechanism.ts';
export {
	CONCIERGE_ONLY_OPS,
	CONCIERGE_WITHHELD_OPS,
	conciergeControlOpDenial,
	retiredControlOpDenial,
	SUBAGENT_UNUSABLE_OPS,
	SUBAGENT_WITHHELD_OPS,
	subAgentControlOpDenial,
	withheldControlOps,
} from './agent-control/subagent-policy.ts';
export type { DiffFilePatch } from './agent-control/workspace-diff.ts';
export {
	budgetWorkspaceDiff,
	clampFilePatch,
	MAX_AGENT_PAYLOAD_CHARS,
} from './agent-control/workspace-diff.ts';
