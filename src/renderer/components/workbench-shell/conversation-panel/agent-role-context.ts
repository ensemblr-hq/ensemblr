import { createContext, use } from 'react';

import type { AgentRoleResolver } from '@/renderer/types/tool-presentation';

const AgentRoleResolverContext = createContext<AgentRoleResolver | null>(null);

export const AgentRoleResolverProvider = AgentRoleResolverContext.Provider;

/**
 * Read the lookup that says what a conversation a control row targeted actually
 * is — a child the turn spawned, or a root orchestrator it does not own.
 *
 * Provided by the workspace conversation surface, which is the only place these
 * calls are made and the only one holding a listing to resolve them against.
 * @returns The resolver, or null before the workspace's tabs are known and on
 *   every other surface, where a row keeps the sub-agent wording that fits the
 *   overwhelming majority of these calls.
 */
export function useAgentRoleResolver(): AgentRoleResolver | null {
	return use(AgentRoleResolverContext);
}
