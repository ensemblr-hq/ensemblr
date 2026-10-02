import { useStore } from 'jotai';
import { useEffect } from 'react';

import { formatLinkedIssueComposerSeed } from '@/renderer/lib/workbench';
import {
	composerLinkedIssueSeededAtomFamily,
	composerValueAtomFamily,
} from '@/renderer/state/composer';
import type { WorkspaceLinkedIssueSummary } from '@/renderer/types/workbench';

/**
 * Hands a workspace created from a tracker issue that issue, as a composer
 * attachment carrying the whole issue document plus a headline in the draft text
 * so the composer reads as being about something rather than opening blank.
 *
 * Both halves are claimed together, under one flag, in one effect. They used to
 * be seeded from separate effects with separate guards, which let them disagree:
 * the seed resolves asynchronously now — it waits on the workspace's session list
 * — and anything that touched the draft inside that window suppressed the
 * headline while the chip attached anyway.
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
		const draftAtom = composerValueAtomFamily(chatTabId);
		if (store.get(draftAtom) === '') {
			store.set(draftAtom, formatLinkedIssueComposerSeed(linkedIssue));
		}
		void attachLinkedIssue(linkedIssue).then((attached) => {
			if (!attached) {
				store.set(seededAtom, false);
			}
		});
	}, [attachLinkedIssue, chatTabId, linkedIssue, store]);
}
