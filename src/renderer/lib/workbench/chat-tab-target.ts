import type { SessionTabModel } from '@/renderer/types/workbench';

/**
 * Suffix of the synthetic session id a workspace shows before its real tab rows
 * arrive. `createPlaceholderSession` mints one per workspace so the shell always
 * has something to render, and it is deliberately never persisted.
 */
const PLACEHOLDER_TAB_SUFFIX = ':overview';

/**
 * Whether an id belongs to the synthetic placeholder rather than a persisted
 * chat tab. Nothing can be delivered to it: it has no row, so the composer
 * mounted over it refuses every send until the real list lands.
 * @param chatTabId - The tab id to classify
 * @returns True when the id is a placeholder
 */
export function isPlaceholderChatTabId(chatTabId: string): boolean {
	return chatTabId.endsWith(PLACEHOLDER_TAB_SUFFIX);
}

/**
 * True for a tab that can take a prompt: a chat (placeholder sessions predate
 * `kind` and count as chat) whose id is a real persisted row.
 */
function isDeliverableChatTab(tab: SessionTabModel): boolean {
	const isChat = tab.kind === undefined || tab.kind === 'chat';
	return isChat && !isPlaceholderChatTabId(tab.chatTabId);
}

/**
 * Resolves the chat tab an agent chore should land in: the tab in front when it
 * is a chat, otherwise the chat tab visited most recently, falling back to the
 * last one in the strip.
 *
 * A viewer tab is never a valid target. Only the active chat tab mounts a
 * composer, so a chore queued against a file, diff, or terminal tab has no
 * consumer and would sit undelivered for the life of the window while the user
 * was told it had been handed over.
 *
 * Neither is the `<workspaceId>:overview` placeholder, which the shell stands in
 * front of a workspace whose tab rows have not arrived. It carries no `kind`, so
 * it reads as a chat, but a prompt queued against it is drained by a composer
 * that refuses it and is then gone. Returning null there is what lets the caller
 * say the chore did not land instead of claiming it did.
 * @param input - The tab in front, the workspace's open tabs, and its visit order
 * @returns The target chat tab id, or null when no chat tab can take the prompt
 */
export function resolveTargetChatTabId({
	activeSession,
	sessionTabs,
	visitOrder,
}: {
	activeSession: SessionTabModel;
	sessionTabs: readonly SessionTabModel[];
	visitOrder?: readonly string[];
}): string | null {
	if (isDeliverableChatTab(activeSession)) {
		return activeSession.chatTabId;
	}
	const chatTabIds = new Set<string>();
	let lastInStrip: string | null = null;
	for (const tab of sessionTabs) {
		if (isDeliverableChatTab(tab)) {
			chatTabIds.add(tab.chatTabId);
			lastInStrip = tab.chatTabId;
		}
	}
	const lastVisited = visitOrder?.find((tabId) => chatTabIds.has(tabId));
	return lastVisited ?? lastInStrip;
}
