/**
 * Provider-neutral classification of agent-runtime failures. Every runtime
 * Ensemblr drives reports a failed turn as prose its provider wrote, so "which
 * kind of failure is this, and can the user act on it?" belongs here rather than
 * inside any one runtime's wire protocol module — main tags the persisted event
 * with the class, and the renderer maps that class to translated copy and
 * recovery actions.
 */

export {
	type ClassifiableAgentFailure,
	classifyAgentFailure,
} from './agent-failure/classify.ts';
export {
	AGENT_FAILURE_CLASSES,
	type AgentFailureClass,
} from './agent-failure/failure-class.ts';
