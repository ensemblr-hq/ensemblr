import { atom, useAtom } from 'jotai';
import { useCallback, useMemo } from 'react';

import type { ComposerAttachment } from '@/renderer/types/workbench';

/**
 * Cross-component channel for attachments that should land in a composer.
 * Sources (transcript chips, plan handoff, fork) push entries keyed by the
 * target chat tab, and the composer drains entries on render.
 */
interface PendingEntry {
	attachment: ComposerAttachment;
	chatTabId: string;
}

/** In-memory queue of attachments awaiting insertion into a chat tab's composer. */
const pendingComposerAttachmentsAtom = atom<readonly PendingEntry[]>([]);

/**
 * Inbox view for the composer — reads and drains entries for a chat tab.
 * @param chatTabId - Chat tab whose queued attachments to read
 * @returns The queued attachments plus a callback that clears them
 */
export function useComposerAttachmentInbox(chatTabId: string): {
	pending: readonly ComposerAttachment[];
	clear: () => void;
} {
	const [all, setAll] = useAtom(pendingComposerAttachmentsAtom);
	const pending = useMemo(() => {
		const attachments: ComposerAttachment[] = [];
		for (const entry of all) {
			if (entry.chatTabId === chatTabId) {
				attachments.push(entry.attachment);
			}
		}
		return attachments;
	}, [all, chatTabId]);
	const clear = useCallback(() => {
		setAll((prev) => prev.filter((entry) => entry.chatTabId !== chatTabId));
	}, [chatTabId, setAll]);
	return { pending, clear };
}

/**
 * Dispatcher for senders — pushes an attachment to the inbox, deduped by id.
 * @returns A callback taking the target chat tab and the attachment to queue
 */
export function useComposerAttachmentDispatcher(): (
	chatTabId: string,
	attachment: ComposerAttachment,
) => void {
	const [, setAll] = useAtom(pendingComposerAttachmentsAtom);
	return useCallback(
		(chatTabId, attachment) => {
			setAll((prev) => {
				if (
					prev.some(
						(entry) =>
							entry.chatTabId === chatTabId &&
							entry.attachment.id === attachment.id,
					)
				) {
					return prev;
				}
				return [...prev, { attachment, chatTabId }];
			});
		},
		[setAll],
	);
}
