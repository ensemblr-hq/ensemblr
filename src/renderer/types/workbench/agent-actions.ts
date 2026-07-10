/** Agent-assisted review actions resolved from settings templates (ENS-059). */
export type AgentActionKind =
	| 'branch-naming'
	| 'create-pr'
	| 'fix-check-errors'
	| 'general'
	| 'resolve-conflicts'
	| 'review';
