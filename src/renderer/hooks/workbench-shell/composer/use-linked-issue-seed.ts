import { useStore } from 'jotai';
import { useEffect } from 'react';

import { composerLinkedIssueSeededAtomFamily } from '@/renderer/state/composer';
import type { WorkspaceLinkedIssueSummary } from '@/renderer/types/workbench';

/**
 * Hands a workspace created from a tracker issue that issue as a composer
 * attachment, so the agent reads the whole issue rather than whatever survives
 * in the draft textbox.
 *
 * Seeds exactly once per chat. The flag is a Jotai atom rather than a ref
 * because a ref resets on every remount and route change, which would put the
 * chip back after the user removed it. It is claimed before the attach is
 * awaited, so a second render during the round-trip cannot start a duplicate —
 * and released again when the attach reports failure, because a flag left set
 * over a failed attach loses the issue for that chat with no way to ask for it
 * back.
 * @param chatTabId - Chat whose composer receives the attachment.
 * @param attachLinkedIssue - Writes the issue out as a document and attaches it.
 * @param linkedIssue - The issue the workspace was created from, when there is one.
 */
export function useLinkedIssueSeed({
	attachLinkedIssue,
	chatTabId,
	linkedIssue,
}: {
	attachLinkedIssue: (
		linkedIssue: WorkspaceLinkedIssueSummary,
	) => Promise<boolean>;
	chatTabId: string;
	linkedIssue?: WorkspaceLinkedIssueSummary;
}): void {
	const store = useStore();

	useEffect(() => {
		if (!linkedIssue) {
			return;
		}
		const seededAtom = composerLinkedIssueSeededAtomFamily(chatTabId);
		if (store.get(seededAtom)) {
			return;
		}
		store.set(seededAtom, true);
		void attachLinkedIssue(linkedIssue).then((attached) => {
			if (!attached) {
				store.set(seededAtom, false);
			}
		});
	}, [attachLinkedIssue, chatTabId, linkedIssue, store]);
}
