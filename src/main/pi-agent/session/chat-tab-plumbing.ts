import type { DatabaseSync } from 'node:sqlite';
import {
	bindPiSession,
	type ChatTabRow,
	openChatTab,
} from '../../storage/repositories/index.ts';

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
