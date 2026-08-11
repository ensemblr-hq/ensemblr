import { useAtomValue } from 'jotai';
import type { EditorState } from 'lexical';
import { type RefObject, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ComposerEditorHandle } from '@/renderer/components/workbench-shell/conversation-panel/composer/editor';
import {
	serializeComposerDraft,
	serializeLinkedDirectories,
} from '@/renderer/lib/workbench/mention-payload';
import {
	useComposerPrimedActionConsumer,
	useComposerSubmitConsumer,
	useFollowUpQueue,
} from '@/renderer/state/composer';
import {
	chatLinkedDirectoriesAtomFamily,
	followUpBehaviorAtom,
} from '@/renderer/state/preferences';
import type {
	ComposerDraftSegment,
	ComposerShellState,
	QueuedFollowUp,
	QueuedFollowUpSource,
} from '@/renderer/types/workbench';
import { flushesAutomatically, useFollowUpFlush } from './use-follow-up-flush';

/**
 * What one send carries. `segments` is the draft in document order, so the
 * outgoing prompt reads the way the composer did; `text` is the same draft
 * flattened, for the emptiness check and for restoring a failed send.
 * `snapshot` is the editor document it came from, kept so that restore puts the
 * chips back in the sentence rather than bunched at the end.
 */
interface ComposerDraft {
	segments: readonly ComposerDraftSegment[];
	snapshot?: EditorState | null;
	text: string;
}

/**
 * A send that carries text and nothing else — a queued Checks chore, a primed
 * agent action, an auto-submitted slash command.
 * @param text - The prompt to send
 * @returns The draft for that text
 */
function textDraft(text: string): ComposerDraft {
	return { segments: [{ kind: 'text', text }], text };
}

/**
 * Whether a draft carries nothing worth sending.
 * @param draft - The text and attachments a send would carry
 * @returns True when there is no text and no attachment
 */
function isEmptyDraft(draft: ComposerDraft): boolean {
	return (
		draft.text.trim().length === 0 &&
		!draft.segments.some((segment) => segment.kind === 'attachment')
	);
}

/**
 * Puts an unsent draft back in the composer. Prefers the document so chips land
 * back in the sentence rather than bunched at the end; plain text is the
 * fallback for a send that never had one, such as a queued chore.
 * @param editorRef - Handle to the mounted editor
 * @param snapshot - The document the draft came from, when it had one
 * @param text - Flattened draft text, used when there is no document
 */
function restoreDraft(
	editorRef: RefObject<ComposerEditorHandle | null>,
	snapshot: EditorState | null | undefined,
	text: string,
): void {
	if (snapshot) {
		editorRef.current?.restore(snapshot);
		return;
	}
	editorRef.current?.setText(text);
}

/**
 * The message to show for a send that threw rather than reporting an outcome —
 * serializing an attachment is the one step here that can.
 * @param cause - Whatever was thrown
 * @param fallback - Translated message for a cause that carries none
 * @returns The message to put in the composer's error strip
 */
function describeSendFailure(cause: unknown, fallback: string): string {
	return cause instanceof Error ? cause.message : fallback;
}

/**
 * What a send does to the composer box around it: empty it before the prompt
 * renders, and put the draft back if the send does not land.
 */
interface DraftLifecycle {
	clear: () => void;
	restore: () => void;
}

/** Leaves the box alone, for a send whose draft never came out of it. */
const DETACHED_DRAFT: DraftLifecycle = {
	clear: () => undefined,
	restore: () => undefined,
};

/**
 * Resolves who owns the composer box for one send. A draft taken off the queue
 * gets {@link DETACHED_DRAFT}: the queue recovers its own entry, and the flush
 * fires on the agent's schedule, so touching the box would clear or overwrite a
 * draft the user is very likely part-way through typing.
 * @param editorRef - Handle to the mounted editor
 * @param outgoing - The draft being sent
 * @param fromQueue - Whether the draft came off the queue rather than the box
 * @returns The clear and restore steps this send should run
 */
function draftLifecycle(
	editorRef: RefObject<ComposerEditorHandle | null>,
	outgoing: ComposerDraft,
	fromQueue: boolean | undefined,
): DraftLifecycle {
	if (fromQueue) {
		return DETACHED_DRAFT;
	}
	return {
		clear: () => editorRef.current?.clear(),
		restore: () => restoreDraft(editorRef, outgoing.snapshot, outgoing.text),
	};
}

/**
 * Turns a draft into a queue entry. Keeps the document alongside the segments so
 * putting the entry back in the composer restores it as it was typed.
 * @param draft - The draft being queued
 * @param source - Whether a user or the Checks panel queued it
 * @returns The entry to append to the queue
 */
function toQueuedFollowUp(
	draft: ComposerDraft,
	source: QueuedFollowUpSource,
): Omit<QueuedFollowUp, 'id' | 'queuedAt'> {
	return {
		segments: draft.segments,
		snapshot: draft.snapshot ?? null,
		source,
		text: draft.text,
	};
}

/**
 * The composer's send pipeline: serializes attachments into the outgoing prompt,
 * clears the draft optimistically and restores it on failure, and maps the
 * Follow-up behavior setting onto the runtime's mid-turn delivery frames. Also
 * drains the two external channels — primed agent actions and Checks-panel
 * chores — through the same path so they respect the same rules.
 *
 * The draft arrives as a reader rather than a value so a send always serializes
 * what the editor holds at the moment it fires, not what it held at the last
 * render.
 * @param input - The composer shell, a reader for the live draft, and the setters a send clears
 * @returns The submit callbacks plus the pending and blocked-notice flags
 */
export function useComposerSubmit({
	chatTabId,
	composer,
	editorRef,
	readDraft,
	setAttachmentError,
}: {
	chatTabId: string;
	composer: ComposerShellState;
	editorRef: RefObject<ComposerEditorHandle | null>;
	readDraft: () => ComposerDraft;
	setAttachmentError: (error: string | null) => void;
}) {
	const { t } = useTranslation();
	const [pending, setPending] = useState(false);
	const followUp = useAtomValue(followUpBehaviorAtom);
	const queue = useFollowUpQueue(chatTabId);
	const linkedDirectories = useAtomValue(
		chatLinkedDirectoriesAtomFamily(chatTabId),
	);

	const submitText = useCallback(
		async (
			outgoing: ComposerDraft,
			options?: {
				fromQueue?: boolean;
				streamingBehavior?: 'steer' | 'followUp';
			},
		): Promise<boolean> => {
			if (composer.disabled || pending || isEmptyDraft(outgoing)) {
				return false;
			}
			const { fromQueue, streamingBehavior } = options ?? {};
			const draft = draftLifecycle(editorRef, outgoing, fromQueue);
			setPending(true);
			setAttachmentError(null);
			try {
				const body = await serializeComposerDraft({
					segments: outgoing.segments,
					workspaceCwd: composer.workspaceCwd,
				});
				const payload = [serializeLinkedDirectories(linkedDirectories), body]
					.filter(Boolean)
					.join('\n\n');
				// Clear the composer before awaiting onSubmit. onSubmit renders an
				// optimistic prompt synchronously, so leaving the draft populated
				// during its async round-trip shows the prompt in two places at once.
				draft.clear();
				// A caller that reports no outcome has reported no failure; reading
				// `.error` off it directly would throw and restore a draft that went.
				const outcome = await composer.onSubmit(
					payload,
					streamingBehavior ? { streamingBehavior } : undefined,
				);
				if (outcome?.error) {
					draft.restore();
					setAttachmentError(outcome.error);
					return false;
				}
				return true;
			} catch (cause) {
				draft.restore();
				setAttachmentError(
					describeSendFailure(
						cause,
						t(
							'workbench:composer.attachment-failed',
							'Failed to attach selected file.',
						),
					),
				);
				return false;
			} finally {
				setPending(false);
			}
		},
		[composer, editorRef, linkedDirectories, pending, setAttachmentError, t],
	);

	/**
	 * Sends an entry the queue handed over, putting it back at the head and
	 * pausing the queue when it does not land. One place owns what a failed
	 * queued send means, so the automatic flush and the user's "Send now" cannot
	 * recover from it differently.
	 * @param entry - The entry taken off the queue
	 * @returns Whether it was delivered
	 */
	const submitQueued = useCallback(
		async (entry: QueuedFollowUp): Promise<boolean> => {
			const delivered = await submitText(
				{
					segments: entry.segments,
					snapshot: entry.snapshot,
					text: entry.text,
				},
				{ fromQueue: true },
			);
			if (!delivered) {
				queue.requeue(entry);
				queue.hold();
			}
			return delivered;
		},
		[queue, submitText],
	);

	/**
	 * Queues a draft for this chat and clears the composer, so a queued message
	 * reads as sent-later rather than sitting in the box as if it were unsent.
	 * @param outgoing - The draft to queue
	 * @param source - Whether a user or the Checks panel queued it
	 */
	const enqueueDraft = useCallback(
		(outgoing: ComposerDraft, source: QueuedFollowUpSource) => {
			queue.enqueue(toQueuedFollowUp(outgoing, source));
			editorRef.current?.clear();
		},
		[editorRef, queue],
	);

	/**
	 * Routes a send by the Follow-up behavior. `steer` keeps the runtime's native
	 * steer frame, which must not wait; `queue` and `block` both hold the message
	 * here so it stays listable and editable, since neither runtime can read back
	 * or cancel what it holds. Idle, every behavior sends a normal prompt.
	 */
	const dispatchSubmit = useCallback(
		(outgoing: ComposerDraft) => {
			if (composer.isStreaming && !isEmptyDraft(outgoing)) {
				if (followUp === 'steer') {
					void submitText(outgoing, { streamingBehavior: 'steer' });
					return;
				}
				enqueueDraft(outgoing, 'user');
				return;
			}
			void submitText(outgoing);
		},
		[composer.isStreaming, enqueueDraft, followUp, submitText],
	);

	/**
	 * Applies a primed agent action: auto-submits it only when the action asked to
	 * and the composer holds no draft — submitText clears the composer, so
	 * auto-submitting over a typed draft would silently discard it — otherwise
	 * seeds the payload after any existing draft for the user to send.
	 */
	const deliverPrimedAction = useCallback(
		(payload: string, autoSubmit: boolean) => {
			const hasDraft = readDraft().text.trim().length > 0;
			if (autoSubmit && !hasDraft) {
				void submitText(textDraft(payload));
				return;
			}
			editorRef.current?.appendText(hasDraft ? `\n\n${payload}` : payload);
		},
		[editorRef, readDraft, submitText],
	);
	useComposerPrimedActionConsumer(
		chatTabId,
		!composer.disabled && !pending,
		deliverPrimedAction,
	);

	/**
	 * Drains a Checks-panel chore (commit & push, create PR) through the same send
	 * pipeline, bypassing the textarea. Mid-turn a chore is queued rather than
	 * dispatched — under `steer` it would otherwise inject a background git chore
	 * into a turn doing something unrelated.
	 * @param text - The chore prompt to hand to this chat's agent
	 * @returns Whether it was accepted; the consumer retries whatever we refuse
	 */
	const submitFromChannel = useCallback(
		(text: string): boolean => {
			if (composer.disabled || pending) {
				return false;
			}
			const draft = textDraft(text);
			if (composer.isStreaming && !isEmptyDraft(draft)) {
				enqueueDraft(draft, 'chore');
				return true;
			}
			void submitText(draft);
			return true;
		},
		[
			composer.disabled,
			composer.isStreaming,
			enqueueDraft,
			pending,
			submitText,
		],
	);
	useComposerSubmitConsumer(chatTabId, submitFromChannel);

	useFollowUpFlush({
		behavior: followUp,
		canSend: !composer.disabled && !pending,
		isStreaming: composer.isStreaming,
		queue,
		submit: submitQueued,
	});

	const [queueHead] = queue.entries;
	// Whether the queue is waiting on the user rather than on the agent: paused
	// after a stop or a failed flush, or holding a `block`-mode message once the
	// agent has freed up. The second case never drains on its own, so without it
	// the panel would show a queue with no way to send it. Mid-turn under `block`
	// there is still nothing the user can do, so it stays false until the turn
	// ends rather than offering a control that would no-op.
	const queueStalled =
		queue.held ||
		(!composer.isStreaming &&
			queueHead !== undefined &&
			!flushesAutomatically(queueHead, followUp));

	return {
		dispatchSubmit,
		/**
		 * Stops the turn and pauses the queue with it. A stop lowers the streaming
		 * flag exactly like a natural finish, so without the pause the flush would
		 * read the interruption as the agent finishing and send the very messages
		 * the user was cutting short.
		 */
		handleStop: useCallback(async () => {
			queue.hold();
			await composer.onStop();
		}, [composer, queue]),
		/**
		 * Drains a stalled queue on the user's say-so. Mid-turn this can only mean
		 * "stop holding" — the head still waits for the turn to end, because that is
		 * the whole point of not steering. Idle, the head goes straight out and the
		 * flush takes the rest as each turn finishes.
		 */
		flushQueueNow: useCallback(() => {
			queue.release();
			if (composer.isStreaming) {
				return;
			}
			const next = queue.takeNext();
			if (next) {
				void submitQueued(next);
			}
		}, [composer.isStreaming, queue, submitQueued]),
		followUp,
		handleSubmit: useCallback(
			() => dispatchSubmit(readDraft()),
			[dispatchSubmit, readDraft],
		),
		pending,
		queue,
		queueStalled,
		// Cmd+J queues the current draft in every mode, so the shortcut means the
		// same thing the queue panel shows. When idle it just sends normally.
		queueCurrent: useCallback(() => {
			const draft = readDraft();
			if (composer.isStreaming && !isEmptyDraft(draft)) {
				enqueueDraft(draft, 'user');
				return;
			}
			void submitText(draft);
		}, [composer.isStreaming, enqueueDraft, readDraft, submitText]),
		/**
		 * Takes a queued entry back out for editing, restoring the document so its
		 * chips land where the user left them.
		 */
		restoreQueued: useCallback(
			(id: string) => {
				const entry = queue.take(id);
				if (!entry) {
					return;
				}
				restoreDraft(editorRef, entry.snapshot, entry.text);
				editorRef.current?.focus();
			},
			[editorRef, queue],
		),
	};
}
