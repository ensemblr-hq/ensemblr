import type { DatabaseSync } from 'node:sqlite';
import {
	bindPiSession,
	type ChatTabRow,
	openChatTab,
	setChatTabMetadata,
} from '../../storage/repositories/index.ts';

/**
 * Clears the naming gate on a tab reused by a new Pi session, so the
 * deterministic namer re-titles it from the new conversation's first prompt
 * instead of leaving the previous session's title. A title the user explicitly
 * owns (`titleProvenance === 'user'`) is left untouched; every other
 * provenance is dropped along with the gate, since a title the previous
 * session's agent chose is as stale as a derived one and would otherwise
 * outrank the new session's namer.
 * @param database - Open SQLite handle.
 * @param tab - The existing tab a new session is rebinding to.
 */
function resetTitleGateForReuse(database: DatabaseSync, tab: ChatTabRow): void {
	if (tab.metadata.titleProvenance === 'user') {
		return;
	}
	if (!tab.metadata.titleAutoNamed) {
		return;
	}
	const { titleProvenance: _released, ...carried } = tab.metadata;
	setChatTabMetadata({
		database,
		id: tab.id,
		metadata: { ...carried, titleAutoNamed: false },
	});
}

/** Binds a new Pi session to an existing chat tab, or creates a tab fallback. */
export function attachSessionToChatTab({
	chatTabId,
	database,
	label,
	sessionId,
	workspaceId,
}: {
	chatTabId: string | null;
	database: DatabaseSync;
	label?: string;
	sessionId: string;
	workspaceId: string;
}): ChatTabRow {
	if (chatTabId) {
		const tab = bindPiSession({
			database,
			id: chatTabId,
			piSessionId: sessionId,
		});
		if (tab) {
			resetTitleGateForReuse(database, tab);
			return tab;
		}
	}

	return openChatTab({
		database,
		input: {
			kind: 'chat',
			piSessionId: sessionId,
			title: label?.trim() || 'Chat',
			workspaceId,
		},
	});
}
