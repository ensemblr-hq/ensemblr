import type { DatabaseSync } from 'node:sqlite';
import {
	bindPiSession,
	type ChatTabRow,
	closeChatTab,
	listOpenChatTabsBySession,
	openChatTab,
} from '../../storage/repositories/chat-tab-repository.ts';

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

/** Closes every still-open chat tab pointing at a stopped session. */
export function closeOpenChatTabs({
	database,
	sessionId,
}: {
	database: DatabaseSync;
	sessionId: string;
}): void {
	const tabs = listOpenChatTabsBySession({ database, sessionId });
	for (const tab of tabs) {
		closeChatTab({ database, id: tab.id });
	}
}
