import { atom, useAtom } from 'jotai';
import { useCallback, useMemo } from 'react';

import type { WorkspaceFileSummary } from '@/renderer/types/workbench';

/**
 * Cross-component channel for files that should land in the composer's
 * mention list. Sources (transcript chips, drag-and-drop, etc.) push entries
 * keyed by the target chat tab, and the composer drains entries on render.
 */
interface PendingEntry {
	chatTabId: string;
	file: WorkspaceFileSummary;
}

/** In-memory queue of files awaiting insertion into a chat tab's composer mention list. */
const pendingComposerAttachmentsAtom = atom<readonly PendingEntry[]>([]);

/** Inbox view for the composer — reads + drains entries for a chat tab. */
export function useComposerAttachmentInbox(chatTabId: string): {
	pending: readonly WorkspaceFileSummary[];
	clear: () => void;
} {
	const [all, setAll] = useAtom(pendingComposerAttachmentsAtom);
	const pending = useMemo(() => {
		const files: WorkspaceFileSummary[] = [];
		for (const entry of all) {
			if (entry.chatTabId === chatTabId) {
				files.push(entry.file);
			}
		}
		return files;
	}, [all, chatTabId]);
	const clear = useCallback(() => {
		setAll((prev) => prev.filter((entry) => entry.chatTabId !== chatTabId));
	}, [chatTabId, setAll]);
	return { pending, clear };
}

/** Dispatcher for senders — pushes a file to the inbox, dedup'd by path. */
export function useComposerAttachmentDispatcher(): (
	chatTabId: string,
	file: WorkspaceFileSummary,
) => void {
	const [, setAll] = useAtom(pendingComposerAttachmentsAtom);
	return useCallback(
		(chatTabId, file) => {
			setAll((prev) => {
				if (
					prev.some(
						(entry) =>
							entry.chatTabId === chatTabId && entry.file.path === file.path,
					)
				) {
					return prev;
				}
				return [...prev, { chatTabId, file }];
			});
		},
		[setAll],
	);
}
