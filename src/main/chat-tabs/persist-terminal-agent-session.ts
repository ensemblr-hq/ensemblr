import type { DatabaseSync } from 'node:sqlite';

import {
	listOpenForWorkspace,
	setChatTabMetadata,
} from '../storage/repositories/chat-tab-repository.ts';

/**
 * Persists a harness's captured native session id onto the open terminal tab that
 * backs the given PTY, so an app restart can reattach that exact conversation via
 * `--resume` instead of spawning a fresh one. Without this the id lived only on
 * the in-memory session snapshot and reached the DB only on a graceful close, so
 * a tab open at quit always rehydrated with a null id and resumed fresh.
 *
 * Keyed by `terminalId` (the tab's live PTY) rather than the chat-tab id, since
 * the terminal-service seam knows only the terminal. No-op when the database is
 * closed, no open terminal tab points at this PTY, or the id is already stored.
 * @param database - Open SQLite connection, or null when unavailable.
 * @param workspaceId - Workspace whose open tabs to search.
 * @param terminalId - Live PTY id the tab's `metadata.terminalId` must match.
 * @param agentSessionId - Native harness session id to persist.
 */
export function persistTerminalAgentSessionId({
	agentSessionId,
	database,
	terminalId,
	workspaceId,
}: {
	agentSessionId: string;
	database: DatabaseSync | null;
	terminalId: string;
	workspaceId: string;
}): void {
	if (!database) {
		return;
	}
	const tab = listOpenForWorkspace({ database, workspaceId }).find(
		(candidate) =>
			candidate.kind === 'terminal' &&
			candidate.metadata.terminalId === terminalId,
	);
	if (!tab || tab.metadata.agentSessionId === agentSessionId) {
		return;
	}
	setChatTabMetadata({
		database,
		id: tab.id,
		metadata: { ...tab.metadata, agentSessionId },
	});
}
