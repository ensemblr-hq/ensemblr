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
} from '@/renderer/state/composer';
import {
	chatLinkedDirectoriesAtomFamily,
	followUpBehaviorAtom,
} from '@/renderer/state/preferences';
import type {
	ComposerDraftSegment,
	ComposerShellState,
} from '@/renderer/types/workbench';

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
	const [blockedNotice, setBlockedNotice] = useState(false);
	const followUp = useAtomValue(followUpBehaviorAtom);
	const linkedDirectories = useAtomValue(
		chatLinkedDirectoriesAtomFamily(chatTabId),
	);

	const submitText = useCallback(
		async (
			outgoing: ComposerDraft,
			streamingBehavior?: 'steer' | 'followUp',
		) => {
			if (composer.disabled || pending || isEmptyDraft(outgoing)) {
				return;
			}
			const { segments, snapshot, text } = outgoing;
			setPending(true);
			setAttachmentError(null);
			try {
				const body = await serializeComposerDraft({
					segments,
					workspaceCwd: composer.workspaceCwd,
				});
				const payload = [serializeLinkedDirectories(linkedDirectories), body]
					.filter(Boolean)
					.join('\n\n');
				// Clear the composer before awaiting onSubmit. onSubmit renders an
				// optimistic prompt synchronously, so leaving the draft populated
				// during its async round-trip shows the prompt in two places at once.
				editorRef.current?.clear();
				try {
					await composer.onSubmit(
						payload,
						streamingBehavior ? { streamingBehavior } : undefined,
					);
				} catch (cause) {
					// Restore the unsent draft so the user does not lose their input.
					if (snapshot) {
						editorRef.current?.restore(snapshot);
					} else {
						editorRef.current?.setText(text);
					}
					throw cause;
				}
			} catch (cause) {
				setAttachmentError(
					cause instanceof Error
						? cause.message
						: t(
								'workbench:composer.attachment-failed',
								'Failed to attach selected file.',
							),
				);
			} finally {
				setPending(false);
			}
		},
		[composer, editorRef, linkedDirectories, pending, setAttachmentError, t],
	);

	// Maps the Follow-up behavior setting onto Pi's native mid-turn delivery:
	// `steer` → `steer` frame (injected after the current tool calls), `queue` →
	// `follow_up` frame (delivered when the agent stops), `block` → dropped. When
	// idle, every mode sends a normal prompt. Pi owns the queue, so there is no
	// renderer-side hold to flush.
	const dispatchSubmit = useCallback(
		(outgoing: ComposerDraft) => {
			if (composer.isStreaming && !isEmptyDraft(outgoing)) {
				if (followUp === 'block') {
					// Keep the draft and explain the no-op rather than eating the key.
					setBlockedNotice(true);
					return;
				}
				setBlockedNotice(false);
				void submitText(outgoing, followUp === 'steer' ? 'steer' : 'followUp');
				return;
			}
			setBlockedNotice(false);
			void submitText(outgoing);
		},
		[composer.isStreaming, followUp, submitText],
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

	// Drain auto-submit prompts queued from the Checks panel (commit & push,
	// create PR). These bypass the textarea and go straight through the normal
	// send pipeline so they respect the Follow-up behavior just like a manual
	// send — the Checks panel hands the chore to the active tab's agent.
	// Returns whether the prompt was accepted for delivery. The consumer keeps
	// anything we reject and retries when this callback is recreated (composer
	// enabled, send finished, streaming ended), so a chore queued while the
	// composer is busy or mid-turn-blocked is held and sent once it is free
	// rather than being dropped. Mirrors the drop conditions above.
	const submitFromChannel = useCallback(
		(text: string): boolean => {
			if (composer.disabled || pending) {
				return false;
			}
			if (
				composer.isStreaming &&
				text.trim().length > 0 &&
				followUp === 'block'
			) {
				return false;
			}
			dispatchSubmit(textDraft(text));
			return true;
		},
		[
			composer.disabled,
			composer.isStreaming,
			dispatchSubmit,
			followUp,
			pending,
		],
	);
	useComposerSubmitConsumer(chatTabId, submitFromChannel);

	return {
		blockedNotice,
		dispatchSubmit,
		followUp,
		handleSubmit: useCallback(
			() => dispatchSubmit(readDraft()),
			[dispatchSubmit, readDraft],
		),
		pending,
		// Cmd+J explicitly queues the current draft as a follow-up regardless of the
		// Follow-up setting; when idle it just sends normally.
		queueCurrent: useCallback(() => {
			void submitText(
				readDraft(),
				composer.isStreaming ? 'followUp' : undefined,
			);
		}, [composer.isStreaming, readDraft, submitText]),
		setBlockedNotice,
	};
}
