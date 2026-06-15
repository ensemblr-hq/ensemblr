import {
	type ChangeEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';
import {
	type KeymapBinding,
	useKeymapHandler,
} from '@/renderer/hooks/use-keymap-handler';
import {
	formatMentionAttachmentText,
	formatUploadAttachmentText,
} from '@/renderer/lib/workbench/mention-payload';
import { useComposerAttachmentInbox } from '@/renderer/state/composer-attachments';
import { useComposerInsertConsumer } from '@/renderer/state/composer-insert';
import type {
	ComposerShellState,
	WorkspaceFileSummary,
} from '@/renderer/types/workbench';
import type { SlashCommandDescriptor } from './slash-commands';
import {
	type AutocompleteKind,
	type AutocompleteState,
	detectAutocomplete,
	useFuzzyMatches,
} from './use-autocomplete';
import { useMentionMatches } from './use-mention-matches';
import { useSlashCommands } from './use-slash-commands';

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
export interface ComposerStateApi {
	activeIndex: number;
	anchorRef: RefObject<HTMLDivElement | null>;
	attachmentError: string | null;
	autocomplete: AutocompleteState;
	autocompleteActive: boolean;
	autocompleteKind: AutocompleteKind;
	autocompleteTotal: number;
	canSubmit: boolean;
	dismissAutocomplete: () => void;
	fileInputRef: RefObject<HTMLInputElement | null>;
	handleAddAttachment: () => void;
	handleChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
	handleFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
	handleKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
	handleSelect: () => void;
	handleSubmit: () => Promise<void> | void;
	hasChips: boolean;
	insertText: (text: string) => void;
	isStreaming: boolean;
	mentionAttachments: readonly WorkspaceFileSummary[];
	mentionMatches: readonly WorkspaceFileSummary[];
	onMentionSelect: (entry: WorkspaceFileSummary) => void;
	onSlashSelect: (command: string, autoSubmit: boolean) => void;
	pending: boolean;
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

	const [value, setValue] = useState('');
	const [pending, setPending] = useState(false);
	const [autocomplete, setAutocomplete] =
		useState<AutocompleteState>(EMPTY_AUTOCOMPLETE);
	const [activeIndex, setActiveIndex] = useState(0);
	const [uploadAttachments, setUploadAttachments] = useState<File[]>([]);
	const [mentionAttachments, setMentionAttachments] = useState<
		WorkspaceFileSummary[]
	>([]);
	const [attachmentError, setAttachmentError] = useState<string | null>(null);

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
	}, [attachmentInbox]);

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
			const caret = event.target.selectionStart ?? nextValue.length;
			updateAutocomplete(nextValue, caret);
		},
		[updateAutocomplete],
	);

	const insertText = useCallback((text: string) => {
		setValue((current) =>
			current.trim().length > 0 ? `${current.trimEnd()}\n\n${text}` : text,
		);
		textareaRef.current?.focus();
	}, []);

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
	}, [seedText, value]);

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
		[autocomplete, dismissAutocomplete, value],
	);

	const submitText = useCallback(
		async (
			rawText: string,
			mentions: readonly WorkspaceFileSummary[],
			uploads: readonly File[],
		) => {
			const trimmed = rawText.trim();
			if (
				composer.disabled ||
				pending ||
				(trimmed.length === 0 && mentions.length === 0 && uploads.length === 0)
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
				const payload = [attachmentText, uploadText, trimmed]
					.filter(Boolean)
					.join('\n\n');
				await composer.onSubmit(payload);
				setValue('');
				setUploadAttachments([]);
				setMentionAttachments([]);
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
		[composer, pending],
	);

	const handleSubmit = useCallback(
		() => submitText(value, mentionAttachments, uploadAttachments),
		[submitText, value, mentionAttachments, uploadAttachments],
	);

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
		[autocomplete, dismissAutocomplete, value],
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
				void submitText(slashText, mentionAttachments, uploadAttachments);
				return;
			}
			replaceToken(slashText);
		},
		[
			autocomplete,
			dismissAutocomplete,
			mentionAttachments,
			replaceToken,
			submitText,
			uploadAttachments,
			value,
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
					void handleSubmit();
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
			slashMatches,
			value.length,
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
		[],
	);

	const removeUpload = useCallback((index: number) => {
		setUploadAttachments((prev) => prev.filter((_, idx) => idx !== index));
	}, []);

	const removeMention = useCallback((path: string) => {
		setAttachmentError(null);
		setMentionAttachments((prev) =>
			prev.filter((entry) => entry.path !== path),
		);
	}, []);

	const isStreaming = composer.isStreaming || pending;
	const canSubmit =
		!composer.disabled &&
		!isStreaming &&
		(value.trim().length > 0 ||
			mentionAttachments.length > 0 ||
			uploadAttachments.length > 0);
	const hasChips =
		uploadAttachments.length > 0 || mentionAttachments.length > 0;

	return {
		activeIndex,
		anchorRef,
		attachmentError,
		autocomplete,
		autocompleteActive,
		autocompleteKind,
		autocompleteTotal,
		canSubmit,
		dismissAutocomplete,
		fileInputRef,
		handleAddAttachment,
		handleChange,
		handleFileChange,
		handleKeyDown,
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
		removeMention,
		removeUpload,
		setActiveIndex,
		slashMatches,
		textareaRef,
		uploadAttachments,
		value,
	};
}
