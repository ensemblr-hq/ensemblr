import { useAtomValue } from 'jotai';
import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import {
	formatExternalAttachmentText,
	formatMentionAttachmentText,
	formatUploadAttachmentText,
} from '@/renderer/lib/workbench/mention-payload';
import {
	useComposerPrimedActionConsumer,
	useComposerSubmitConsumer,
} from '@/renderer/state/composer';
import { followUpBehaviorAtom } from '@/renderer/state/preferences';
import type {
	ComposerShellState,
	ExternalAttachment,
	WorkspaceFileSummary,
} from '@/renderer/types/workbench';

/** The draft and every chip list one send carries. */
interface ComposerDraft {
	externals: readonly ExternalAttachment[];
	mentions: readonly WorkspaceFileSummary[];
	text: string;
	uploads: readonly File[];
}

/**
 * Whether a draft carries nothing worth sending.
 * @param draft - The text and chip lists a send would carry
 * @returns True when there is no text and no attachment
 */
function isEmptyDraft(draft: ComposerDraft): boolean {
	return (
		draft.text.trim().length === 0 &&
		draft.mentions.length === 0 &&
		draft.uploads.length === 0 &&
		draft.externals.length === 0
	);
}

/**
 * The composer's send pipeline: serializes chips into the outgoing prompt,
 * clears the draft optimistically and restores it on failure, and maps the
 * Follow-up behavior setting onto the runtime's mid-turn delivery frames. Also
 * drains the two external channels — primed agent actions and Checks-panel
 * chores — through the same path so they respect the same rules.
 * @param input - The composer shell, the live draft, and the setters a send clears
 * @returns The submit callbacks plus the pending and blocked-notice flags
 */
export function useComposerSubmit({
	chatTabId,
	composer,
	draft,
	setAttachmentError,
	setExternalAttachments,
	setMentionAttachments,
	setUploadAttachments,
	setValue,
}: {
	chatTabId: string;
	composer: ComposerShellState;
	draft: ComposerDraft;
	setAttachmentError: (error: string | null) => void;
	setExternalAttachments: Dispatch<
		SetStateAction<readonly ExternalAttachment[]>
	>;
	setMentionAttachments: Dispatch<
		SetStateAction<readonly WorkspaceFileSummary[]>
	>;
	setUploadAttachments: Dispatch<SetStateAction<readonly File[]>>;
	setValue: Dispatch<SetStateAction<string>>;
}) {
	const { t } = useTranslation();
	const [pending, setPending] = useState(false);
	const [blockedNotice, setBlockedNotice] = useState(false);
	const followUp = useAtomValue(followUpBehaviorAtom);

	const submitText = useCallback(
		async (
			outgoing: ComposerDraft,
			streamingBehavior?: 'steer' | 'followUp',
		) => {
			if (composer.disabled || pending || isEmptyDraft(outgoing)) {
				return;
			}
			const { externals, mentions, text, uploads } = outgoing;
			setPending(true);
			setAttachmentError(null);
			try {
				const attachmentText = await formatMentionAttachmentText({
					mentions,
					workspaceCwd: composer.workspaceCwd,
				});
				const uploadText = await formatUploadAttachmentText(uploads);
				const externalText = formatExternalAttachmentText(externals);
				const payload = [attachmentText, uploadText, externalText, text.trim()]
					.filter(Boolean)
					.join('\n\n');
				// Clear the composer before awaiting onSubmit. onSubmit renders an
				// optimistic prompt synchronously, so leaving the textarea populated
				// during its async round-trip shows the prompt in two places at once.
				setValue('');
				setUploadAttachments([]);
				setMentionAttachments([]);
				setExternalAttachments([]);
				try {
					await composer.onSubmit(
						payload,
						streamingBehavior ? { streamingBehavior } : undefined,
					);
				} catch (cause) {
					// Restore the unsent text so the user does not lose their input.
					setValue(text);
					setUploadAttachments([...uploads]);
					setMentionAttachments([...mentions]);
					setExternalAttachments([...externals]);
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
		[
			composer,
			pending,
			setAttachmentError,
			setValue,
			setExternalAttachments,
			setUploadAttachments,
			setMentionAttachments,
			t,
		],
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
			const hasDraft = draft.text.trim().length > 0;
			if (autoSubmit && !hasDraft) {
				void submitText({
					externals: [],
					mentions: [],
					text: payload,
					uploads: [],
				});
				return;
			}
			setValue((current) =>
				current.trim().length > 0
					? `${current.trimEnd()}\n\n${payload}`
					: payload,
			);
		},
		[draft.text, submitText, setValue],
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
			dispatchSubmit({ externals: [], mentions: [], text, uploads: [] });
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
			() => dispatchSubmit(draft),
			[dispatchSubmit, draft],
		),
		pending,
		// Cmd+J explicitly queues the current draft as a follow-up regardless of the
		// Follow-up setting; when idle it just sends normally.
		queueCurrent: useCallback(() => {
			void submitText(draft, composer.isStreaming ? 'followUp' : undefined);
		}, [composer.isStreaming, draft, submitText]),
		setBlockedNotice,
	};
}
