import { useAtomValue } from 'jotai';
import type { EditorState } from 'lexical';
import { type RefObject, useCallback, useRef, useState } from 'react';
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
	ComposerSubmitOptions,
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
 * How far one send got, which is what tells a benign refusal apart from a broken
 * session. `rejected` is the composer declining to take it this instant — a send
 * already in flight, or a composer not yet ready — and surfaces nothing to the
 * user, because nothing is wrong; `failed` is a send that was attempted and did
 * not land, and always leaves an error on screen. An `empty` draft is a no-op in
 * the editor but a malformed queue entry that needs editing, not another retry.
 */
type ComposerSendOutcome = 'empty' | 'failed' | 'rejected' | 'sent';

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
	/** Synchronous lock across same-tick sends; pending state wakes the flush on release. */
	const sendingRef = useRef(false);
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
				streamingBehavior?: ComposerSubmitOptions['streamingBehavior'];
			},
		): Promise<ComposerSendOutcome> => {
			if (composer.disabled || sendingRef.current) {
				return 'rejected';
			}
			if (isEmptyDraft(outgoing)) {
				return 'empty';
			}
			const { fromQueue, streamingBehavior } = options ?? {};
			const linkedDirectoryPaths = Object.freeze(
				linkedDirectories.map((directory) => directory.path),
			);
			const draft = draftLifecycle(editorRef, outgoing, fromQueue);
			sendingRef.current = true;
			setPending(true);
			setAttachmentError(null);
			try {
				const body = await serializeComposerDraft({
					segments: outgoing.segments,
					workspaceCwd: composer.workspaceCwd,
				});
				const payload = [serializeLinkedDirectories(linkedDirectoryPaths), body]
					.filter(Boolean)
					.join('\n\n');
				// Clear the composer before awaiting onSubmit. onSubmit renders an
				// optimistic prompt synchronously, so leaving the draft populated
				// during its async round-trip shows the prompt in two places at once.
				draft.clear();
				// A caller that reports no outcome has reported no failure; reading
				// `.error` off it directly would throw and restore a draft that went.
				const outcome = await composer.onSubmit(payload, {
					linkedDirectories: linkedDirectoryPaths,
					...(streamingBehavior ? { streamingBehavior } : {}),
				});
				if (outcome?.error) {
					draft.restore();
					setAttachmentError(outcome.error);
					return 'failed';
				}
				return 'sent';
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
				return 'failed';
			} finally {
				sendingRef.current = false;
				setPending(false);
			}
		},
		[composer, editorRef, linkedDirectories, setAttachmentError, t],
	);

	/**
	 * Sends an entry the queue handed over, putting it back where it came from
	 * when it does not go. One place owns what an undelivered queued send means,
	 * so the automatic flush, the header's resume, and a row's steer cannot
	 * recover from it differently.
	 *
	 * Busy or disabled sends wait for the flush's readiness gate without counting
	 * refusals or creating a persistent hold. Only a real failure or an empty
	 * entry pauses; an empty entry cannot become sendable by retrying and leaves
	 * an actionable error instead of spinning the flush.
	 *
	 * `restoreAt` is what keeps that shared recovery honest for a row that was not
	 * the head: the flush only ever hands over the front of the queue, but a steer
	 * can lift the third message out, and dropping that one back at the front on a
	 * failure reorders a queue the user arranged deliberately.
	 * @param entry - The entry taken off the queue
	 * @param options - Where to put it back when it does not go, and the frame to deliver it in mid-turn
	 */
	const submitQueued = useCallback(
		async (
			entry: QueuedFollowUp,
			options?: {
				restoreAt?: number;
				streamingBehavior?: 'steer' | 'followUp';
			},
		): Promise<void> => {
			const outcome = await submitText(
				{
					segments: entry.segments,
					snapshot: entry.snapshot,
					text: entry.text,
				},
				{ fromQueue: true, streamingBehavior: options?.streamingBehavior },
			);
			if (outcome === 'sent') {
				return;
			}
			queue.requeue(entry, options?.restoreAt);
			if (outcome === 'rejected') {
				return;
			}
			if (outcome === 'empty') {
				setAttachmentError(
					t(
						'workbench:composer.queued-message-empty',
						'The queued message is empty. Edit or remove it before resuming the queue.',
					),
				);
			}
			queue.hold('send-failed');
		},
		[queue, setAttachmentError, submitText, t],
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
	 * Drains a send raised outside the textarea — a Checks-panel chore (commit &
	 * push, create PR), or a failed turn re-sent from its error row — through the
	 * same pipeline a typed message takes. Mid-turn it is queued rather than
	 * dispatched: under `steer` a background chore would otherwise be injected
	 * into a turn doing something unrelated.
	 * @param text - The prompt to hand to this chat's agent
	 * @param source - Who raised it, which decides how the queue drains it
	 * @returns Whether it was accepted; the consumer retries whatever we refuse
	 */
	const submitFromChannel = useCallback(
		(text: string, source: QueuedFollowUpSource): boolean => {
			if (composer.disabled || pending || sendingRef.current) {
				return false;
			}
			const draft = textDraft(text);
			if (composer.isStreaming && !isEmptyDraft(draft)) {
				enqueueDraft(draft, source);
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
	// Whether the queue is waiting on the user rather than on the agent: its head
	// paused after a stop or a failed flush, or a `block`-mode message held once
	// the agent has freed up. The second case never drains on its own, so without
	// it the panel would show a queue with no way to send it. Mid-turn under
	// `block` there is still nothing the user can do, so it stays false until the
	// turn ends rather than offering a control that would no-op.
	const queueStalled =
		queue.holdReason !== null ||
		(!composer.isStreaming &&
			queueHead !== undefined &&
			!flushesAutomatically(queueHead, followUp));

	return {
		dispatchSubmit,
		/**
		 * Stops the turn and parks the messages that were waiting for it. A stop
		 * lowers the streaming flag exactly like a natural finish, so without the
		 * pause the flush would read the interruption as the agent finishing and
		 * send the very messages the user was cutting short.
		 *
		 * It parks those messages and no others. The streaming flag reads a session
		 * status that only settles a round-trip after the stop, so a message typed
		 * straight afterwards is queued rather than sent — and holding the whole
		 * queue would strand it behind an interruption it was written in answer to.
		 */
		handleStop: useCallback(async () => {
			queue.hold('turn-stopped');
			await composer.onStop();
		}, [composer, queue]),
		/**
		 * Drains a stalled queue on the user's say-so. Mid-turn this can only mean
		 * "stop holding" — the head still waits for the turn to end, because that is
		 * the whole point of not steering. Idle, the head goes straight out and the
		 * flush takes the rest as each turn finishes.
		 *
		 * Busy or disabled controls leave both entries and holds untouched.
		 * Releases only a pause the user can see. This control is the strip's one
		 * button and it says two different things: `Resume` when the head is paused,
		 * `Send next` when the behavior is merely holding it back. Since a pause is
		 * scoped to the messages a stop parked, a queue can be unpaused at the head
		 * and still be guarding a stopped message further down — releasing there
		 * would discard that guard on a press the user read as "send this one", and
		 * the parked message would then drain on its own turn.
		 */
		flushQueueNow: useCallback(() => {
			if (composer.disabled || sendingRef.current) {
				return;
			}
			if (queue.holdReason !== null) {
				queue.release();
			}
			if (composer.isStreaming) {
				return;
			}
			const next = queue.takeNext();
			if (next) {
				void submitQueued(next);
			}
		}, [composer.disabled, composer.isStreaming, queue, submitQueued]),
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
		 * Sends the current draft this instant, whatever the Follow-up behavior says.
		 * Mid-turn it goes as a steer frame, which is the only delivery that reaches
		 * a turn already running; `queue` and `block` would both have parked it, and
		 * bypassing them is the whole point. Idle it is an ordinary send, so the
		 * shortcut never means something different from the send button.
		 *
		 * Deliberately leaves an existing queue alone: jumping one message past the
		 * queue is a decision about that message, and draining the rest behind it
		 * would send everything the user had parked.
		 */
		sendNow: useCallback(() => {
			const draft = readDraft();
			void submitText(draft, {
				streamingBehavior:
					composer.isStreaming && !isEmptyDraft(draft) ? 'steer' : undefined,
			});
		}, [composer.isStreaming, readDraft, submitText]),
		/**
		 * Takes a queued entry back out for editing, restoring the document so its
		 * chips land where the user left them.
		 */
		restoreQueued: useCallback(
			(id: string) => {
				const taken = queue.take(id);
				if (!taken) {
					return;
				}
				restoreDraft(editorRef, taken.entry.snapshot, taken.entry.text);
				editorRef.current?.focus();
			},
			[editorRef, queue],
		),
		/**
		 * Sends one queued entry out of turn: mid-turn it goes as a steer frame,
		 * reaching the agent inside the work it is already doing; idle it is an
		 * ordinary send that jumps the rest of the queue.
		 *
		 * Busy or disabled controls leave the row in place.
		 * Deliberately leaves a paused queue paused. Steering one message is a
		 * decision about that message, and resuming the whole queue off the back of
		 * it would send everything the user had parked behind it. A send that does
		 * not land puts the row back in the place it was steered out of, so a
		 * failure costs the user nothing but the attempt.
		 */
		steerQueued: useCallback(
			(id: string) => {
				if (composer.disabled || sendingRef.current) {
					return;
				}
				const taken = queue.take(id);
				if (!taken) {
					return;
				}
				void submitQueued(taken.entry, {
					restoreAt: taken.index,
					streamingBehavior: composer.isStreaming ? 'steer' : undefined,
				});
			},
			[composer.disabled, composer.isStreaming, queue, submitQueued],
		),
	};
}
