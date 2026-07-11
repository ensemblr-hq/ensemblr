import { useAtom, useAtomValue } from 'jotai';
import {
	type ChangeEvent,
	type ClipboardEvent as ReactClipboardEvent,
	type DragEvent as ReactDragEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import { useKeymapHandler } from '@/renderer/hooks/use-keymap-handler';
import {
	detectAutocomplete,
	useFuzzyMatches,
} from '@/renderer/hooks/workbench-shell/composer/use-autocomplete';
import { useMentionMatches } from '@/renderer/hooks/workbench-shell/composer/use-mention-matches';
import { useSlashCommands } from '@/renderer/hooks/workbench-shell/composer/use-slash-commands';
import {
	attachPastedFiles,
	getTransferFiles,
} from '@/renderer/lib/workbench/composer-attachments';
import {
	formatExternalAttachmentText,
	formatMentionAttachmentText,
	formatUploadAttachmentText,
} from '@/renderer/lib/workbench/mention-payload';
import {
	composerExternalsAtomFamily,
	composerMentionsAtomFamily,
	composerUploadsAtomFamily,
	composerValueAtomFamily,
	useComposerAttachmentInbox,
	useComposerInsertConsumer,
	useComposerSubmitConsumer,
} from '@/renderer/state/composer';
import {
	autoConvertLongTextAtom,
	followUpBehaviorAtom,
	sendShortcutAtom,
} from '@/renderer/state/preferences';
import type { KeymapBinding } from '@/renderer/types/keymap';
import type {
	AutocompleteKind,
	AutocompleteState,
	ComposerShellState,
	ExternalAttachment,
	SlashCommandDescriptor,
	WorkspaceFileSummary,
} from '@/renderer/types/workbench';

/** Inputs required by the composer state hook. */
interface UseComposerStateArgs {
	chatTabId: string;
	composer: ComposerShellState;
	/** Initial context (e.g. linked-issue summary) applied to an untouched composer. */
	seedText?: string;
}

/**
 * Aggregated state and callbacks returned to the orchestrator. The shape is
 * designed so the JSX layer only wires refs, derived booleans, and event
 * handlers — it owns no domain logic.
 */
interface ComposerStateApi {
	activeIndex: number;
	anchorRef: RefObject<HTMLDivElement | null>;
	attachmentError: string | null;
	/**
	 * True after a mid-stream submit was dropped because the Follow-up behavior is
	 * set to "block". Lets the composer explain the no-op instead of swallowing
	 * the keypress silently. Cleared on the next edit or submit.
	 */
	blockedNotice: boolean;
	autocomplete: AutocompleteState;
	autocompleteActive: boolean;
	autocompleteKind: AutocompleteKind;
	autocompleteTotal: number;
	canSubmit: boolean;
	dismissAutocomplete: () => void;
	externalAttachments: readonly ExternalAttachment[];
	fileInputRef: RefObject<HTMLInputElement | null>;
	handleAddAttachment: () => void;
	handleChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
	handleDragOver: (event: ReactDragEvent<HTMLElement>) => void;
	handleDrop: (event: ReactDragEvent<HTMLElement>) => void;
	handleFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
	handleKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
	handlePaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
	handleSelect: () => void;
	handleSubmit: () => Promise<void> | void;
	hasChips: boolean;
	insertText: (text: string) => void;
	isStreaming: boolean;
	/** Send the current draft to Pi as a follow-up (Cmd+J). */
	queueCurrent: () => void;
	mentionAttachments: readonly WorkspaceFileSummary[];
	mentionMatches: readonly WorkspaceFileSummary[];
	onMentionSelect: (entry: WorkspaceFileSummary) => void;
	onSlashSelect: (command: string, autoSubmit: boolean) => void;
	pending: boolean;
	removeExternal: (absolutePath: string) => void;
	removeMention: (path: string) => void;
	removeUpload: (index: number) => void;
	setActiveIndex: (index: number) => void;
	slashMatches: readonly SlashCommandDescriptor[];
	textareaRef: RefObject<HTMLTextAreaElement | null>;
	uploadAttachments: readonly File[];
	value: string;
}

/** Default empty autocomplete state — caret outside any `@` or `/` token. */
const EMPTY_AUTOCOMPLETE: AutocompleteState = {
	kind: null,
	query: '',
	tokenStart: 0,
	tokenEnd: 0,
};

/** Pasted text at or above this length is auto-converted into an attachment. */
const PASTE_ATTACHMENT_THRESHOLD = 5_000;

/**
 * Owns the composer's local state machine: textarea value, mention + slash
 * autocomplete, chip lists for mentions and uploaded files, keymap bindings,
 * and the submit pipeline that serializes attachments into the outgoing
 * prompt. Returns a stable shape so the parent component is a thin JSX
 * orchestrator.
 *
 * The submit pipeline inlines uploaded file text alongside @ mentions so the
 * existing `prompt: string` IPC contract stays untouched — uploads no longer
 * vanish silently when the user hits send.
 */
export function useComposerState({
	chatTabId,
	composer,
	seedText,
}: UseComposerStateArgs): ComposerStateApi {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const anchorRef = useRef<HTMLDivElement | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	const [value, setValue] = useAtom(composerValueAtomFamily(chatTabId));
	const [pending, setPending] = useState(false);
	const [autocomplete, setAutocomplete] =
		useState<AutocompleteState>(EMPTY_AUTOCOMPLETE);
	const [activeIndex, setActiveIndex] = useState(0);
	const [uploadAttachments, setUploadAttachments] = useAtom(
		composerUploadsAtomFamily(chatTabId),
	);
	const [mentionAttachments, setMentionAttachments] = useAtom(
		composerMentionsAtomFamily(chatTabId),
	);
	const [externalAttachments, setExternalAttachments] = useAtom(
		composerExternalsAtomFamily(chatTabId),
	);
	const [attachmentError, setAttachmentError] = useState<string | null>(null);
	const [blockedNotice, setBlockedNotice] = useState(false);

	const autoConvertLong = useAtomValue(autoConvertLongTextAtom);
	const followUp = useAtomValue(followUpBehaviorAtom);

	// Drain externally-pushed attachments (transcript chips, etc.) into the
	// composer's mention list. Dedup by path so re-clicking the same chip is
	// a no-op.
	const attachmentInbox = useComposerAttachmentInbox(chatTabId);
	useEffect(() => {
		if (attachmentInbox.pending.length === 0) {
			return;
		}
		setMentionAttachments((prev) => {
			const next = [...prev];
			for (const file of attachmentInbox.pending) {
				if (!next.some((existing) => existing.path === file.path)) {
					next.push(file);
				}
			}
			return next;
		});
		attachmentInbox.clear();
	}, [attachmentInbox, setMentionAttachments]);

	const mentionMatches = useMentionMatches(
		composer.workspaceFiles,
		autocomplete.kind === 'mention' ? autocomplete.query : '',
	);

	const slashCommands = useSlashCommands(composer.workspaceCwd);
	const slashMatches = useFuzzyMatches(
		slashCommands,
		autocomplete.kind === 'slash' ? autocomplete.query : '',
		(entry) => entry.command,
		80,
	);

	const mentionOpen = autocomplete.kind === 'mention';
	const slashOpen = autocomplete.kind === 'slash';

	const updateAutocomplete = useCallback((nextValue: string, caret: number) => {
		setAutocomplete(detectAutocomplete(nextValue, caret));
		setActiveIndex(0);
	}, []);

	const handleChange = useCallback(
		(event: ChangeEvent<HTMLTextAreaElement>) => {
			const nextValue = event.target.value;
			setValue(nextValue);
			setBlockedNotice(false);
			const caret = event.target.selectionStart ?? nextValue.length;
			updateAutocomplete(nextValue, caret);
		},
		[updateAutocomplete, setValue],
	);

	const insertText = useCallback(
		(text: string) => {
			setValue((current) =>
				current.trim().length > 0 ? `${current.trimEnd()}\n\n${text}` : text,
			);
			textareaRef.current?.focus();
		},
		[setValue],
	);

	// Drain review-context insertions queued from the Checks panel / diff views.
	useComposerInsertConsumer(insertText);

	// Seed the composer once per mount for issue-created workspaces. Only an
	// untouched composer is seeded so user input is never overwritten.
	const seedAppliedRef = useRef(false);
	useEffect(() => {
		if (seedText && !seedAppliedRef.current && value === '') {
			seedAppliedRef.current = true;
			setValue(seedText);
		}
	}, [seedText, value, setValue]);

	const handleSelect = useCallback(() => {
		const textarea = textareaRef.current;
		if (!textarea) {
			return;
		}
		const caret = textarea.selectionStart ?? textarea.value.length;
		updateAutocomplete(textarea.value, caret);
	}, [updateAutocomplete]);

	const dismissAutocomplete = useCallback(() => {
		setAutocomplete(EMPTY_AUTOCOMPLETE);
		setActiveIndex(0);
	}, []);

	const replaceToken = useCallback(
		(insert: string, keepTrailingSpace = true) => {
			const { tokenStart, tokenEnd } = autocomplete;
			const before = value.slice(0, tokenStart);
			const after = value.slice(tokenEnd);
			const trailing = keepTrailingSpace ? ' ' : '';
			const next = `${before}${insert}${trailing}${after}`;
			setValue(next);
			dismissAutocomplete();
			requestAnimationFrame(() => {
				const textarea = textareaRef.current;
				if (!textarea) {
					return;
				}
				const newCaret = before.length + insert.length + trailing.length;
				textarea.focus();
				textarea.setSelectionRange(newCaret, newCaret);
			});
		},
		[autocomplete, dismissAutocomplete, value, setValue],
	);

	const submitText = useCallback(
		async (
			rawText: string,
			mentions: readonly WorkspaceFileSummary[],
			uploads: readonly File[],
			externals: readonly ExternalAttachment[],
			streamingBehavior?: 'steer' | 'followUp',
		) => {
			const trimmed = rawText.trim();
			if (
				composer.disabled ||
				pending ||
				(trimmed.length === 0 &&
					mentions.length === 0 &&
					uploads.length === 0 &&
					externals.length === 0)
			) {
				return;
			}
			setPending(true);
			setAttachmentError(null);
			try {
				const attachmentText = await formatMentionAttachmentText({
					mentions,
					workspaceCwd: composer.workspaceCwd,
				});
				const uploadText = await formatUploadAttachmentText(uploads);
				const externalText = formatExternalAttachmentText(externals);
				const payload = [attachmentText, uploadText, externalText, trimmed]
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
					setValue(rawText);
					setUploadAttachments([...uploads]);
					setMentionAttachments([...mentions]);
					setExternalAttachments([...externals]);
					throw cause;
				}
			} catch (cause) {
				setAttachmentError(
					cause instanceof Error
						? cause.message
						: 'Failed to attach selected file.',
				);
			} finally {
				setPending(false);
			}
		},
		[
			composer,
			pending,
			setValue,
			setExternalAttachments,
			setUploadAttachments,
			setMentionAttachments,
		],
	);

	// Maps the Follow-up behavior setting onto Pi's native mid-turn delivery:
	// `steer` → `steer` frame (injected after the current tool calls), `queue` →
	// `follow_up` frame (delivered when the agent stops), `block` → dropped. When
	// idle, every mode sends a normal prompt. Pi owns the queue, so there is no
	// renderer-side hold to flush.
	const dispatchSubmit = useCallback(
		(
			rawText: string,
			mentions: readonly WorkspaceFileSummary[],
			uploads: readonly File[],
			externals: readonly ExternalAttachment[],
		) => {
			const empty =
				rawText.trim().length === 0 &&
				mentions.length === 0 &&
				uploads.length === 0 &&
				externals.length === 0;
			if (composer.isStreaming && !empty) {
				if (followUp === 'block') {
					// Keep the draft and explain the no-op rather than eating the key.
					setBlockedNotice(true);
					return;
				}
				setBlockedNotice(false);
				void submitText(
					rawText,
					mentions,
					uploads,
					externals,
					followUp === 'steer' ? 'steer' : 'followUp',
				);
				return;
			}
			setBlockedNotice(false);
			void submitText(rawText, mentions, uploads, externals);
		},
		[composer.isStreaming, followUp, submitText],
	);

	const handleSubmit = useCallback(
		() =>
			dispatchSubmit(
				value,
				mentionAttachments,
				uploadAttachments,
				externalAttachments,
			),
		[
			dispatchSubmit,
			value,
			mentionAttachments,
			uploadAttachments,
			externalAttachments,
		],
	);

	// Drain auto-submit prompts queued from the Checks panel (commit & push,
	// create PR). These bypass the textarea and go straight through the normal
	// send pipeline so they respect the Follow-up behavior just like a manual
	// send — the Checks panel hands the chore to the active tab's agent.
	// Returns whether the prompt was accepted for delivery. The consumer keeps
	// anything we reject and retries when this callback is recreated (composer
	// enabled, send finished, streaming ended), so a chore queued while the
	// composer is busy or mid-turn-blocked is held and sent once it is free
	// rather than being dropped. Mirrors the drop conditions in `submitText` and
	// `dispatchSubmit`.
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
			dispatchSubmit(text, [], [], []);
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
	useComposerSubmitConsumer(submitFromChannel);

	// Cmd+J explicitly queues the current draft as a follow-up regardless of the
	// Follow-up setting; when idle it just sends normally.
	const queueCurrent = useCallback(() => {
		void submitText(
			value,
			mentionAttachments,
			uploadAttachments,
			externalAttachments,
			composer.isStreaming ? 'followUp' : undefined,
		);
	}, [
		composer.isStreaming,
		submitText,
		value,
		mentionAttachments,
		uploadAttachments,
		externalAttachments,
	]);

	/**
	 * Persists pasted/dropped files via {@link attachPastedFiles}, then merges the
	 * copied files onto the mention chips and the path-referenced ones onto the
	 * external chips, de-duplicating by path so a repeated paste is a no-op.
	 */
	const handlePastedFiles = useCallback(
		async (files: readonly File[]) => {
			setAttachmentError(null);
			const { error, savedExternals, savedFiles } = await attachPastedFiles(
				files,
				composer.workspaceCwd,
			);
			if (error) {
				setAttachmentError(error);
			}
			if (savedFiles.length > 0) {
				setMentionAttachments((prev) => {
					const next = [...prev];
					for (const file of savedFiles) {
						if (!next.some((existing) => existing.path === file.path)) {
							next.push(file);
						}
					}
					return next;
				});
			}
			if (savedExternals.length > 0) {
				setExternalAttachments((prev) => {
					const next = [...prev];
					for (const external of savedExternals) {
						if (
							!next.some(
								(existing) => existing.absolutePath === external.absolutePath,
							)
						) {
							next.push(external);
						}
					}
					return next;
				});
			}
		},
		[composer.workspaceCwd, setMentionAttachments, setExternalAttachments],
	);

	/** Handles file pastes and long-text paste conversion for the textarea. */
	const handlePaste = useCallback(
		(event: ReactClipboardEvent<HTMLTextAreaElement>) => {
			const files = getTransferFiles(event.clipboardData);
			if (files.length > 0) {
				event.preventDefault();
				void handlePastedFiles(files);
				return;
			}
			if (!autoConvertLong) {
				return;
			}
			const text = event.clipboardData.getData('text/plain');
			if (text.length < PASTE_ATTACHMENT_THRESHOLD) {
				return;
			}
			event.preventDefault();
			const file = new File([text], 'pasted-text.txt', { type: 'text/plain' });
			setUploadAttachments((prev) => [...prev, file]);
			setAttachmentError(null);
		},
		[autoConvertLong, handlePastedFiles, setUploadAttachments],
	);

	/** Accepts files dropped onto the composer, saving them like a paste. */
	const handleDrop = useCallback(
		(event: ReactDragEvent<HTMLElement>) => {
			const files = getTransferFiles(event.dataTransfer);
			if (files.length === 0) {
				return;
			}
			event.preventDefault();
			void handlePastedFiles(files);
		},
		[handlePastedFiles],
	);

	/** Signals the composer as a valid drop target so `handleDrop` can fire. */
	const handleDragOver = useCallback((event: ReactDragEvent<HTMLElement>) => {
		if (Array.from(event.dataTransfer.types).includes('Files')) {
			event.preventDefault();
		}
	}, []);

	const onMentionSelect = useCallback(
		(entry: WorkspaceFileSummary) => {
			// Drop the @query token from textarea, push file onto chip list
			setAttachmentError(null);
			const { tokenStart, tokenEnd } = autocomplete;
			const before = value.slice(0, tokenStart);
			const after = value.slice(tokenEnd);
			const nextValue = `${before.trimEnd()}${before.trimEnd().length > 0 ? ' ' : ''}${after.trimStart()}`;
			setValue(nextValue);
			setMentionAttachments((prev) => {
				if (prev.some((existing) => existing.path === entry.path)) {
					return prev;
				}
				return [...prev, entry];
			});
			dismissAutocomplete();
			requestAnimationFrame(() => {
				const textarea = textareaRef.current;
				if (!textarea) {
					return;
				}
				const newCaret = before.trimEnd().length + 1;
				textarea.focus();
				textarea.setSelectionRange(newCaret, newCaret);
			});
		},
		[autocomplete, dismissAutocomplete, value, setValue, setMentionAttachments],
	);

	const onSlashSelect = useCallback(
		(command: string, autoSubmit: boolean) => {
			const { tokenStart, tokenEnd } = autocomplete;
			const before = value.slice(0, tokenStart);
			const after = value.slice(tokenEnd);
			const slashText = `/${command}`;
			if (
				autoSubmit &&
				before.trim().length === 0 &&
				after.trim().length === 0
			) {
				dismissAutocomplete();
				setValue('');
				dispatchSubmit(
					slashText,
					mentionAttachments,
					uploadAttachments,
					externalAttachments,
				);
				return;
			}
			replaceToken(slashText);
		},
		[
			autocomplete,
			dismissAutocomplete,
			dispatchSubmit,
			externalAttachments,
			mentionAttachments,
			replaceToken,
			uploadAttachments,
			value,
			setValue,
		],
	);

	const autocompleteKind: AutocompleteKind = mentionOpen
		? 'mention'
		: slashOpen
			? 'slash'
			: null;
	const autocompleteTotal =
		autocompleteKind === 'mention'
			? mentionMatches.length
			: autocompleteKind === 'slash'
				? slashMatches.length
				: 0;
	const autocompleteActive = autocompleteKind !== null && autocompleteTotal > 0;

	const sendShortcut = useAtomValue(sendShortcutAtom);

	const keymapBindings = useMemo<readonly KeymapBinding<HTMLTextAreaElement>[]>(
		() => [
			[
				'autocomplete.next',
				() => {
					if (!autocompleteActive) {
						return false;
					}
					setActiveIndex((prev) => (prev + 1) % autocompleteTotal);
				},
			],
			[
				'autocomplete.prev',
				() => {
					if (!autocompleteActive) {
						return false;
					}
					setActiveIndex(
						(prev) => (prev - 1 + autocompleteTotal) % autocompleteTotal,
					);
				},
			],
			[
				'autocomplete.confirm',
				() => {
					if (!autocompleteActive) {
						return false;
					}
					if (autocompleteKind === 'mention') {
						const match = mentionMatches[activeIndex];
						if (match) {
							onMentionSelect(match);
						}
					} else {
						const match = slashMatches[activeIndex];
						if (match) {
							onSlashSelect(match.command, match.autoSubmit);
						}
					}
				},
			],
			[
				'autocomplete.dismiss',
				() => {
					if (autocompleteKind === null) {
						return false;
					}
					dismissAutocomplete();
				},
			],
			[
				'composer.removeLastMention',
				() => {
					if (value.length !== 0 || mentionAttachments.length === 0) {
						return false;
					}
					setMentionAttachments((prev) => prev.slice(0, -1));
				},
			],
			[
				'composer.submit',
				(event) => {
					if (event.nativeEvent.isComposing) {
						return false;
					}
					// In "Cmd + Enter" mode a bare Enter inserts a newline instead
					// (fall through to the textarea's native handling).
					if (sendShortcut === 'mod+enter') {
						return false;
					}
					void handleSubmit();
				},
			],
			[
				'composer.submitWithMod',
				(event) => {
					if (event.nativeEvent.isComposing) {
						return false;
					}
					void handleSubmit();
				},
			],
			[
				'composer.queue',
				() => {
					queueCurrent();
				},
			],
		],
		[
			activeIndex,
			autocompleteActive,
			autocompleteKind,
			autocompleteTotal,
			dismissAutocomplete,
			handleSubmit,
			mentionAttachments.length,
			mentionMatches,
			onMentionSelect,
			onSlashSelect,
			queueCurrent,
			sendShortcut,
			slashMatches,
			value.length,
			setMentionAttachments,
		],
	);

	const handleKeyDown = useKeymapHandler(keymapBindings);

	const handleAddAttachment = useCallback(() => {
		fileInputRef.current?.click();
	}, []);

	const handleFileChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			const files = event.target.files ? [...event.target.files] : [];
			if (files.length > 0) {
				setUploadAttachments((prev) => [...prev, ...files]);
			}
			event.target.value = '';
		},
		[setUploadAttachments],
	);

	const removeUpload = useCallback(
		(index: number) => {
			setUploadAttachments((prev) => prev.filter((_, idx) => idx !== index));
		},
		[setUploadAttachments],
	);

	const removeMention = useCallback(
		(path: string) => {
			setAttachmentError(null);
			setMentionAttachments((prev) =>
				prev.filter((entry) => entry.path !== path),
			);
		},
		[setMentionAttachments],
	);

	const removeExternal = useCallback(
		(absolutePath: string) => {
			setAttachmentError(null);
			setExternalAttachments((prev) =>
				prev.filter((entry) => entry.absolutePath !== absolutePath),
			);
		},
		[setExternalAttachments],
	);

	const isStreaming = composer.isStreaming || pending;
	const canSubmit =
		!composer.disabled &&
		!isStreaming &&
		(value.trim().length > 0 ||
			mentionAttachments.length > 0 ||
			uploadAttachments.length > 0 ||
			externalAttachments.length > 0);
	const hasChips =
		uploadAttachments.length > 0 ||
		mentionAttachments.length > 0 ||
		externalAttachments.length > 0;

	return {
		activeIndex,
		anchorRef,
		attachmentError,
		blockedNotice,
		autocomplete,
		autocompleteActive,
		autocompleteKind,
		autocompleteTotal,
		canSubmit,
		dismissAutocomplete,
		externalAttachments,
		fileInputRef,
		handleAddAttachment,
		handleChange,
		handleDragOver,
		handleDrop,
		handleFileChange,
		handleKeyDown,
		handlePaste,
		handleSelect,
		handleSubmit,
		hasChips,
		insertText,
		isStreaming,
		mentionAttachments,
		mentionMatches,
		onMentionSelect,
		onSlashSelect,
		pending,
		queueCurrent,
		removeExternal,
		removeMention,
		removeUpload,
		setActiveIndex,
		slashMatches,
		textareaRef,
		uploadAttachments,
		value,
	};
}
