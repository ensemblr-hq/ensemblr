import { useAtomValue } from 'jotai';
import { useEffect, useRef } from 'react';

import { pinChatTab } from '@/renderer/api/ensemblr-queries';
import {
	composerAttachmentsAtomFamily,
	composerValueAtomFamily,
} from '@/renderer/state/composer';

/**
 * Claims a placeholder chat for the user the first time they put something in
 * it, so an agent spawning into this workspace opens its own tab instead.
 *
 * The workspace bootstrap opens one blank chat for a workspace that has none and
 * marks it as a tab a spawn may take over, rather than stacking a second beside
 * it and leaving one permanently blank. A draft never leaves the renderer — it
 * is in-memory by design — so without this the main process cannot tell that
 * blank tab from one the user is halfway through writing a prompt into.
 *
 * Sent once per tab, and again after a failed send, so a claim lost to a dropped
 * call is retaken on the next edit rather than leaving the tab open to a spawn.
 * Pinning a tab that is already permanent is a no-op, so a repeat after a tab
 * switch costs one round trip and nothing else.
 * @param chatTabId - Chat tab the composer is mounted for
 */
export function useClaimPlaceholderTab(chatTabId: string): void {
	const draft = useAtomValue(composerValueAtomFamily(chatTabId));
	const attachments = useAtomValue(composerAttachmentsAtomFamily(chatTabId));
	const claimedTabRef = useRef<string | null>(null);

	useEffect(() => {
		const spent = draft.length > 0 || attachments.length > 0;
		if (!spent || claimedTabRef.current === chatTabId) {
			return;
		}
		claimedTabRef.current = chatTabId;
		pinChatTab({ chatTabId }).catch((error: unknown) => {
			claimedTabRef.current = null;
			console.error('Failed to claim the placeholder chat tab:', error);
		});
	}, [attachments, chatTabId, draft]);
}
