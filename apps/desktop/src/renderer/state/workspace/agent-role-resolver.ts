import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { listChatTabsQuery } from '@/renderer/api/ensemblr-queries';
import { isSubAgentTab } from '@/renderer/lib/workbench/sub-agent-tab';
import type {
	AgentRoleResolver,
	TimelineAgentRole,
} from '@/renderer/types/tool-presentation';

/**
 * Reads back what each conversation in a workspace is, so a control row in the
 * timeline names its target rather than assuming every one is a child.
 *
 * Both halves of the listing are indexed. An orchestrator closes a delegate's tab
 * once it has collected the report, and the row that steered it stays in the
 * transcript long after — so resolving open tabs alone would neutralize exactly
 * the rows a finished fan-out leaves behind.
 *
 * Their order is load-bearing rather than incidental. `bindAgentSession` clears a
 * session's pointer only off *open* rows, so an archived tab keeps pointing at a
 * session another tab now hosts and one id can name two rows; main breaks that
 * tie open-first (`getChatTabByAgentSessionId` orders `closed_at IS NULL DESC`).
 * Indexing closed first lets the open row overwrite it and land on the same
 * answer, where the reverse would let a stale archived row name a live
 * conversation.
 *
 * Nothing is answered until the listing has actually loaded: the resolver is null
 * while the query is in flight, which keeps the sub-agent wording on first paint
 * instead of flashing the neutral fallback and settling a moment later.
 * @param workspaceId - The workspace whose conversations the rows can target.
 * @returns The lookup, or null until the workspace's tabs are known.
 */
export function useWorkspaceAgentRoleResolver(
	workspaceId: string,
): AgentRoleResolver | null {
	const { data, isSuccess } = useQuery(listChatTabsQuery(workspaceId));

	return useMemo(() => {
		if (!isSuccess || !data) {
			return null;
		}
		const roles = new Map<string, TimelineAgentRole>();
		for (const tab of [...data.closed, ...data.open]) {
			if (tab.agentSessionId) {
				roles.set(
					tab.agentSessionId,
					isSubAgentTab(tab) ? 'subagent' : 'orchestrator',
				);
			}
		}
		return (agentSessionId: string) => roles.get(agentSessionId) ?? null;
	}, [data, isSuccess]);
}
