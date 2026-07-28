import { atom, useAtom } from 'jotai';
import { atomFamily } from 'jotai/utils';
import { useEffect } from 'react';
import { buildActionAttachmentBlock } from '@/renderer/lib/workbench/action-prompts';

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

/**
 * Drains a per-tab {@link PrimedAction} into the mounted composer. When one is
 * primed and the composer can accept it, composes the outgoing payload — the
 * trigger message followed by the inlined prompt attachment — hands it to
 * `deliver`, then clears the primed action so it is consumed exactly once. Held
 * until `ready` so an action queued during tab initialization is delivered once
 * the composer is free rather than dropped.
 * @param chatTabId - Chat tab whose primed action to drain.
 * @param ready - False while the composer cannot accept the action (disabled or a send in flight).
 * @param deliver - Receives the composed payload and whether the action requested auto-submit.
 */
export function useComposerPrimedActionConsumer(
	chatTabId: string,
	ready: boolean,
	deliver: (payload: string, autoSubmit: boolean) => void,
): void {
	const [primedAction, setPrimedAction] = useAtom(
		primedActionAtomFamily(chatTabId),
	);

	useEffect(() => {
		if (!primedAction || !ready) {
			return;
		}
		const payload = `${primedAction.message}\n\n${buildActionAttachmentBlock(
			primedAction.attachmentPath,
			primedAction.attachmentContent,
		)}`;
		const { autoSubmit } = primedAction;
		setPrimedAction(null);
		// The action is primed by a different subtree (Review / Create PR), so this
		// bridge can only run from an effect; there is no shared parent to lift into,
		// and returning it would move the same effect back to the flagged caller.
		// oxlint-disable-next-line react-doctor/no-pass-live-state-to-parent, react-doctor/no-pass-data-to-parent
		deliver(payload, autoSubmit);
	}, [primedAction, ready, deliver, setPrimedAction]);
}
