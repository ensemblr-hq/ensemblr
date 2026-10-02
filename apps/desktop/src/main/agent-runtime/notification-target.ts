import type { DatabaseSync } from 'node:sqlite';

import { isTabMarkedSubAgent } from '../agent-control/sub-agent-marker.ts';
import { getChatTabByAgentSessionId } from '../storage/repositories/chat-tab-repository.ts';
import { selectWorkspaceWithRepositoryById } from '../storage/repositories/workspace-repository.ts';

/**
 * Everything a desktop notification needs about the chat that produced it,
 * resolved in one place so the gate and the copy never disagree about which
 * chat they are talking about.
 */
export interface NotificationTarget {
	chatTabId: string | null;
	isSubAgent: boolean;
	tabTitle: string | null;
	workspaceId: string;
	workspaceName: string;
}

/**
 * Reads a workspace's display name, falling back to its id so a notification is
 * never left with an empty body.
 * @param database - Open database connection.
 * @param workspaceId - The workspace to name.
 * @returns The workspace name, or the id when the row has none.
 */
function readWorkspaceName(
	database: DatabaseSync,
	workspaceId: string,
): string {
	const row = selectWorkspaceWithRepositoryById({ database, workspaceId }) as
		| Record<string, unknown>
		| undefined;
	const name = row?.name;
	return typeof name === 'string' && name.trim() ? name : workspaceId;
}

/**
 * Resolves the chat behind an agent session into the workspace name, tab title,
 * and sub-agent marker a notification is gated and worded by.
 *
 * Best-effort by design: a closed database, a missing tab, or a failed read
 * reports null rather than throwing, and the caller then stays silent — a
 * notification nobody can attribute is worse than no notification.
 *
 * A closed tab reports `chatTabId: null` rather than its own id. The lookup
 * falls back to a closed tab when a session has no open one, but the renderer
 * only navigates to open tabs; null is what makes it resolve the tab itself and
 * land on the workspace when there is none.
 *
 * An empty `workspaceId` is unattributable and reports null for the same reason.
 * The app-level Concierge belongs to no workspace and holds no chat tab, so a
 * target built for it names neither: the notification would read "Untitled chat"
 * over a body whose `{{workspace}}` substituted to nothing, and clicking it
 * would ask the renderer to open a workspace that does not exist. Its
 * questionnaire is shown in the Concierge panel instead.
 * @param database - Open database connection, or null before one is.
 * @param workspaceId - Workspace the session belongs to; empty for the Concierge, which has none.
 * @param agentSessionId - The session that finished or blocked.
 * @returns The resolved target, or null when it cannot be read or attributed.
 */
export function resolveNotificationTarget(
	database: DatabaseSync | null | undefined,
	workspaceId: string,
	agentSessionId: string,
): NotificationTarget | null {
	if (!database || !workspaceId) {
		return null;
	}
	try {
		const tab = getChatTabByAgentSessionId({ agentSessionId, database });
		return {
			chatTabId: tab?.closedAt === null ? tab.id : null,
			isSubAgent: isTabMarkedSubAgent(tab),
			tabTitle: tab?.fullTitle ?? tab?.title ?? null,
			workspaceId,
			workspaceName: readWorkspaceName(database, workspaceId),
		};
	} catch (cause) {
		console.warn('[notifications] could not resolve a notification target.', {
			agentSessionId,
			cause: cause instanceof Error ? cause.message : String(cause),
		});
		return null;
	}
}
