/**
 * Durable, validated position of an Ensemblr agent session in its delegation tree.
 * Session identifiers are always Ensemblr `agent_sessions.id` values, never a
 * runtime-native conversation id. A null root means ancestry could not be
 * proved and therefore fails closed at the maximum depth.
 */
export interface AgentSessionLineage {
	parentSessionId: string | null;
	rootSessionId: string | null;
	depth: 0 | 1 | 2;
}
