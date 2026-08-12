import { atom, useAtom } from 'jotai';
import { useCallback, useMemo } from 'react';

import type { ComposerAttachment } from '@/renderer/types/workbench';

/**
 * Where a queued attachment is addressed. A sender that knows the chat names it;
 * a review surface that knows only the workspace broadcasts to whichever
 * composer is mounted on that root — which is as wide as an entry may go, since
 * an attachment's path is workspace-relative and a composer on another root
 * would resolve it against the wrong tree.
 */
export type ComposerAttachmentTarget =
	| { chatTabId: string }
	| { workspaceCwd: string };

/**
 * Cross-component channel for attachments that should land in a composer.
 * Sources (transcript chips, plan handoff, fork, review surfaces) push entries
 * against a target, and each composer drains the ones addressed to it on render.
 */
interface PendingEntry {
	attachment: ComposerAttachment;
	target: ComposerAttachmentTarget;
}

/** In-memory queue of attachments awaiting insertion into a composer. */
const pendingComposerAttachmentsAtom = atom<readonly PendingEntry[]>([]);

/**
 * Whether a queued entry belongs to the composer asking for it: one named for
 * this chat, or one broadcast across the workspace root this composer edits.
 * @param entry - The queued entry being tested
 * @param chatTabId - Chat tab of the composer draining the inbox
 * @param workspaceCwd - Workspace root that composer's paths resolve against
 * @returns True when this composer should take the entry
 */
function isAddressedTo(
	entry: PendingEntry,
	chatTabId: string,
	workspaceCwd: string,
): boolean {
	return 'chatTabId' in entry.target
		? entry.target.chatTabId === chatTabId
		: entry.target.workspaceCwd === workspaceCwd;
}

/**
 * Whether two targets name the same recipient, so the dispatcher's dedupe does
 * not treat a chat-addressed entry and a workspace-addressed one as the same.
 * @param left - The target already queued
 * @param right - The target being dispatched
 * @returns True when both address the same recipient
 */
function isSameTarget(
	left: ComposerAttachmentTarget,
	right: ComposerAttachmentTarget,
): boolean {
	if ('chatTabId' in left) {
		return 'chatTabId' in right && left.chatTabId === right.chatTabId;
	}
	return 'workspaceCwd' in right && left.workspaceCwd === right.workspaceCwd;
}

/**
 * Inbox view for the composer — reads and drains the entries addressed to it.
 * @param chatTabId - Chat tab whose queued attachments to read
 * @param workspaceCwd - Workspace root this composer's paths resolve against
 * @returns The queued attachments plus a callback that clears them
 */
export function useComposerAttachmentInbox(
	chatTabId: string,
	workspaceCwd: string,
): {
	pending: readonly ComposerAttachment[];
	clear: () => void;
} {
	const [all, setAll] = useAtom(pendingComposerAttachmentsAtom);
	const pending = useMemo(() => {
		const attachments: ComposerAttachment[] = [];
		for (const entry of all) {
			if (isAddressedTo(entry, chatTabId, workspaceCwd)) {
				attachments.push(entry.attachment);
			}
		}
		return attachments;
	}, [all, chatTabId, workspaceCwd]);
	const clear = useCallback(() => {
		setAll((prev) =>
			prev.filter((entry) => !isAddressedTo(entry, chatTabId, workspaceCwd)),
		);
	}, [chatTabId, setAll, workspaceCwd]);
	return { pending, clear };
}

/**
 * Dispatcher for senders — pushes an attachment to the inbox, deduped by id.
 * @returns A callback taking the target and the attachment to queue
 */
export function useComposerAttachmentDispatcher(): (
	target: ComposerAttachmentTarget,
	attachment: ComposerAttachment,
) => void {
	const [, setAll] = useAtom(pendingComposerAttachmentsAtom);
	return useCallback(
		(target, attachment) => {
			setAll((prev) => {
				if (
					prev.some(
						(entry) =>
							isSameTarget(entry.target, target) &&
							entry.attachment.id === attachment.id,
					)
				) {
					return prev;
				}
				return [...prev, { attachment, target }];
			});
		},
		[setAll],
	);
}

/**
 * Dispatcher for senders that know the attachment but not the chat — the review
 * surfaces, which sit outside the conversation. The attachment-side counterpart
 * of `useComposerInsert`, landing in whichever composer is mounted on the same
 * workspace root the attachment was written under.
 * @param workspaceCwd - Absolute workspace root the attachment's path belongs to
 * @returns A callback taking the attachment to queue for that workspace
 */
export function useComposerAttachmentInsert(
	workspaceCwd: string,
): (attachment: ComposerAttachment) => void {
	const dispatch = useComposerAttachmentDispatcher();
	return useCallback(
		(attachment: ComposerAttachment) => {
			dispatch({ workspaceCwd }, attachment);
		},
		[dispatch, workspaceCwd],
	);
}
