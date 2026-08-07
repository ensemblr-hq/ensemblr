/**
 * The durable answer to "was this session spawned as somebody's sub-agent?".
 *
 * Lineage cannot answer it. `parentSessionId` lives only in the origin registry,
 * so a session resumed after a restart re-registers at depth 0 and reads as a
 * root orchestrator. Plan Mode, meanwhile, is persisted per chat tab, so the
 * resumed tab is still planning — and a planning agent that looks like a root
 * regains `exitPlanMode`, `askUserQuestion`, and `startConversation`, the three
 * ops the sub-agent policy exists to deny.
 *
 * The marker on the chat tab does survive, because it is a column rather than a
 * process fact. Both the control service's role resolution and the env overlay
 * that picks a playbook read it through here, so enforcement and prose cannot
 * disagree about what a session is.
 */
import type { DatabaseSync } from 'node:sqlite';

import { getChatTabByAgentSessionId } from '../storage/repositories/chat-tab-repository.ts';

/**
 * Reports whether the chat tab bound to a Pi session is stamped as hosting a
 * spawned sub-agent. Best-effort: a closed database, a session with no tab, or a
 * failed read all report no marker, which leaves role resolution to lineage
 * exactly as it was before the marker existed.
 * @param database - Open database connection, or null/undefined before one is.
 * @param agentSessionId - The session whose tab to inspect.
 * @returns True when the session's tab carries the sub-agent marker.
 */
export function isSessionTabMarkedSubAgent(
	database: DatabaseSync | null | undefined,
	agentSessionId: string,
): boolean {
	if (!database) {
		return false;
	}
	try {
		const tab = getChatTabByAgentSessionId({
			agentSessionId,
			database,
		});
		return tab?.metadata.agentRole === 'subagent';
	} catch (cause) {
		console.warn('[agent-control] could not read a tab’s sub-agent marker.', {
			cause: cause instanceof Error ? cause.message : String(cause),
			agentSessionId,
		});
		return false;
	}
}
