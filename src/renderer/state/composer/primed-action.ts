import { atom } from 'jotai';
import { atomFamily } from 'jotai/utils';

/**
 * A prompt prepared for one chat tab by an agent action (Review, Create PR…).
 * The composer that mounts for that tab consumes it: it builds the outgoing
 * message from `message` plus the inlined attachment block and, when
 * `autoSubmit` is set, sends it. Keyed per tab so only the intended tab's
 * composer drains it — a freshly opened Review tab or the last-active chat tab
 * for Create PR — with no cross-tab race against the previously active composer.
 */
export interface PrimedAction {
	/** True to send immediately; false seeds the composer for the user to send. */
	autoSubmit: boolean;
	/** Workspace-relative path the composed prompt was persisted at. */
	attachmentPath: string;
	/** Full composed prompt content, inlined verbatim into the outgoing message. */
	attachmentContent: string;
	/** Short trigger message shown in front of the attachment. */
	message: string;
}

/** Per-chat-tab pending agent action, or `null` when the tab has none primed. */
export const primedActionAtomFamily = atomFamily((_chatTabId: string) =>
	atom<PrimedAction | null>(null),
);
