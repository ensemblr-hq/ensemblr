import { useSetAtom } from 'jotai';
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type RefObject,
	useCallback,
	useRef,
	useState,
} from 'react';

import type { ComposerEditorHandle } from '@/renderer/components/workbench-shell/conversation-panel/composer/editor';
import { useConciergeReferenceMatches } from '@/renderer/hooks/concierge/use-concierge-reference-matches';
import { detectAutocomplete } from '@/renderer/hooks/workbench-shell/composer/use-autocomplete';
import { PASTE_ATTACHMENT_THRESHOLD } from '@/renderer/hooks/workbench-shell/composer/use-composer-attachments';
import { useSlashCommands } from '@/renderer/hooks/workbench-shell/composer/use-slash-commands';
import { useSlashMatches } from '@/renderer/hooks/workbench-shell/composer/use-slash-matches';
import { conciergeReferenceAttachment } from '@/renderer/lib/concierge';
import { joinDictatedText } from '@/renderer/lib/dictation';
import { mentionReplacementRange } from '@/renderer/lib/workbench/composer';
import {
	attachPastedFiles,
	attachPastedText,
} from '@/renderer/lib/workbench/composer-attachments';
import { serializeComposerDraft } from '@/renderer/lib/workbench/mention-payload';
import {
	recordSlashCommandUse,
	slashCommandUsageAtom,
} from '@/renderer/state/slash-commands';
import type {
	AutocompleteKind,
	AutocompleteState,
	ComposerAttachment,
	ComposerDraftSegment,
	ConciergeReferenceMatch,
	SlashCommandMatch,
} from '@/renderer/types/workbench';
import type { AgentProviderId } from '@/shared/agent-provider';
import type { ConciergeReference } from '@/shared/concierge-references';

/** What the Concierge composer's JSX layer needs from its draft state machine. */
export interface ConciergeComposerDraft {
	activeIndex: number;
	attachmentError: string | null;
	/** Which autocomplete list is open, if any. */
	autocompleteKind: AutocompleteKind;
	/** True when the draft has text or a chip to send. */
	canSend: boolean;
	clear: () => void;
	consumeDroppedTransfer: (data: DataTransfer) => boolean;
	consumePastedTransfer: (data: DataTransfer) => boolean;
	editorRef: RefObject<ComposerEditorHandle | null>;
	handleDraftChange: (change: {
		caret: number;
		segments: readonly ComposerDraftSegment[];
		text: string;
	}) => void;
	handleKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
	fileInputRef: RefObject<HTMLInputElement | null>;
	/** Applies the files the hidden input collected. */
	handleFileInputChange: (event: {
		target: { files: FileList | null; value: string };
	}) => void;
	/** True while the draft holds an attachment chip. */
	hasChips: boolean;
	/** Inserts a transcribed phrase at the caret, spaced to read as prose. */
	insertDictatedText: (text: string) => void;
	/** Opens the file picker the attachment menu drives. */
	openFilePicker: () => void;
	/** Surfaces a send-path failure on the composer's own error line. */
	reportError: (message: string) => void;
	/** Every project, workspace, and chat matching the open `@` token. */
	referenceMatches: readonly ConciergeReferenceMatch[];
	/** Opens the `@` menu from a control, for a user who has not met the key. */
	startReference: () => void;
	/** Writes the reference a popover row was clicked on into the draft as a chip. */
	selectReference: (reference: ConciergeReference) => void;
	/** Applies the command a popover row was clicked on. */
	selectSlashCommand: (command: string, autoSubmit: boolean) => void;
	/** Renders the draft — text and chips in document order — as one prompt. */
	readPrompt: () => Promise<string>;
	setActiveIndex: (index: number) => void;
	slashLoading: boolean;
	slashMatches: readonly SlashCommandMatch[];
	text: string;
}

/** Caret outside any `@` or `/` token. */
const NO_AUTOCOMPLETE: AutocompleteState = {
	kind: null,
	query: '',
	tokenStart: 0,
	tokenEnd: 0,
};

/**
 * Owns the Concierge composer's draft: its segments, its attachments, and both
 * of its autocomplete menus.
 *
 * Everything here is the workspace composer's own machinery pointed at the
 * Concierge home instead of a worktree — `attachPastedFiles` and
 * `serializeComposerDraft` both take a cwd rather than a workspace, and the
 * slash catalogue is resolved per runtime and cwd. `@` is the one place the two
 * composers genuinely differ: a workspace composer ranks it against that
 * workspace's file list, and the Concierge — which has no workspace and no file
 * list — ranks it against every project, workspace, and chat in the app.
 * @param input - The Concierge home and the runtime the composer is on.
 * @returns The draft state machine.
 */
export function useConciergeComposerDraft({
	cwd,
	onSubmitSlashCommand,
	provider,
}: {
	cwd: string;
	/** Fires when the user picks a command that submits on its own. */
	onSubmitSlashCommand: (text: string) => void;
	provider: AgentProviderId;
}): ConciergeComposerDraft {
	const recordSlashUsage = useSetAtom(slashCommandUsageAtom);
	const editorRef = useRef<ComposerEditorHandle | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const [segments, setSegments] = useState<readonly ComposerDraftSegment[]>([]);
	const [text, setText] = useState('');
	const [attachmentError, setAttachmentError] = useState<string | null>(null);
	const [autocomplete, setAutocomplete] =
		useState<AutocompleteState>(NO_AUTOCOMPLETE);
	const [activeIndex, setActiveIndex] = useState(0);

	const slashOpen = autocomplete.kind === 'slash';
	const referenceOpen = autocomplete.kind === 'mention';
	const catalogue = useSlashCommands(provider, cwd, slashOpen);
	const slashMatches = useSlashMatches(
		catalogue.commands,
		slashOpen ? autocomplete.query : '',
		slashOpen,
	);
	const referenceMatches = useConciergeReferenceMatches(
		referenceOpen ? autocomplete.query : '',
		referenceOpen,
	);
	const openMatchCount = referenceOpen
		? referenceMatches.length
		: slashMatches.length * Number(slashOpen);
	// The reference list narrows under a stored index without the draft being
	// touched — the app-wide tab listing refetches, a project leaves the shell —
	// which would strand the highlight past the end and make Enter a silent
	// no-op. Held here rather than reset, so the row the user arrowed to keeps
	// its highlight for as long as the list still reaches it.
	const safeActiveIndex = Math.min(
		activeIndex,
		Math.max(0, openMatchCount - 1),
	);

	const addAttachments = useCallback(
		(incoming: readonly ComposerAttachment[]) => {
			for (const entry of incoming) {
				editorRef.current?.insertAttachment(entry);
			}
		},
		[],
	);

	const attachFiles = useCallback(
		async (files: readonly File[]) => {
			setAttachmentError(null);
			const result = await attachPastedFiles(files, cwd);
			if (result.error) {
				setAttachmentError(result.error);
			}
			if (result.attachments.length > 0) {
				addAttachments(result.attachments);
			}
		},
		[addAttachments, cwd],
	);

	const handleDraftChange = useCallback(
		(change: {
			caret: number;
			segments: readonly ComposerDraftSegment[];
			text: string;
		}) => {
			setSegments(change.segments);
			setText(change.text);
			setAutocomplete(detectAutocomplete(change.text, change.caret));
			setActiveIndex(0);
		},
		[],
	);

	const selectReference = useCallback(
		(reference: ConciergeReference) => {
			const range = mentionReplacementRange(text, autocomplete);
			setAutocomplete(NO_AUTOCOMPLETE);
			editorRef.current?.replaceRangeWithAttachment(
				range.start,
				range.end,
				conciergeReferenceAttachment(reference),
			);
		},
		[autocomplete, text],
	);

	const selectSlashCommand = useCallback(
		(command: string, autoSubmit: boolean) => {
			setAutocomplete(NO_AUTOCOMPLETE);
			recordSlashUsage((usage) =>
				recordSlashCommandUse(usage, command, Date.now()),
			);
			const slashText = `/${command}`;
			// Auto-submitting only when the command is the whole draft: a command
			// typed after a sentence is an argument to that sentence, and sending it
			// alone would throw the sentence away.
			if (autoSubmit && text.trim() === slashText) {
				editorRef.current?.clear();
				onSubmitSlashCommand(slashText);
				return;
			}
			editorRef.current?.setText(`${slashText} `);
		},
		[onSubmitSlashCommand, recordSlashUsage, text],
	);

	const applyMatch = useCallback(
		(index: number) => {
			if (referenceOpen) {
				const match = referenceMatches[index];
				if (match) {
					selectReference(match.reference);
				}
				return;
			}
			const match = slashMatches[index];
			if (match) {
				selectSlashCommand(match.item.command, match.item.autoSubmit);
			}
		},
		[
			referenceMatches,
			referenceOpen,
			selectReference,
			selectSlashCommand,
			slashMatches,
		],
	);

	const handleFileInputChange = useCallback(
		(event: { target: { files: FileList | null; value: string } }) => {
			const files = Array.from(event.target.files ?? []);
			// Cleared so picking the same file twice in a row still fires a change.
			event.target.value = '';
			if (files.length > 0) {
				void attachFiles(files);
			}
		},
		[attachFiles],
	);

	const handleKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLElement>) => {
			// Ahead of the row count, because a menu reporting no matches still
			// covers the composer and Escape is the only thing that dismisses it
			// without editing the token that opened it.
			if (autocomplete.kind !== null && event.key === 'Escape') {
				event.preventDefault();
				setAutocomplete(NO_AUTOCOMPLETE);
				return;
			}
			if (openMatchCount === 0) {
				return;
			}
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				setActiveIndex((safeActiveIndex + 1) % openMatchCount);
				return;
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				setActiveIndex((safeActiveIndex - 1 + openMatchCount) % openMatchCount);
				return;
			}
			if (event.key === 'Enter' || event.key === 'Tab') {
				event.preventDefault();
				applyMatch(safeActiveIndex);
			}
		},
		[autocomplete.kind, applyMatch, openMatchCount, safeActiveIndex],
	);

	// The caret position is not mirrored here the way the workspace composer
	// mirrors it, so the whole draft stands in for the text before it. Dictation
	// runs against an unfocused editor, where Lexical inserts at the end anyway.
	const insertDictatedText = useCallback(
		(phrase: string) => {
			const joined = joinDictatedText(text, phrase);
			if (!joined) {
				return;
			}
			editorRef.current?.insertText(joined);
			editorRef.current?.focus();
		},
		[text],
	);

	// The token is written into the draft rather than the menu being opened
	// directly, so the control and the key reach the same state — including the
	// leading space `detectAutocomplete` needs to read an `@` as a token at all.
	const startReference = useCallback(() => {
		editorRef.current?.insertText(/\S$/.test(text) ? ' @' : '@');
		editorRef.current?.focus();
	}, [text]);

	const consumePastedTransfer = useCallback(
		(data: DataTransfer): boolean => {
			const files = Array.from(data.files ?? []);
			if (files.length > 0) {
				void attachFiles(files);
				return true;
			}
			const pasted = data.getData('text/plain');
			if (pasted.length < PASTE_ATTACHMENT_THRESHOLD) {
				return false;
			}
			// A write that fails leaves the paste to the editor rather than
			// surfacing an error, because the default was already prevented and
			// dropping it would lose the clipboard.
			void attachPastedText(pasted, cwd)
				.then((attachment: ComposerAttachment) => addAttachments([attachment]))
				.catch(() => editorRef.current?.insertText(pasted));
			return true;
		},
		[addAttachments, attachFiles, cwd],
	);

	const consumeDroppedTransfer = useCallback(
		(data: DataTransfer): boolean => {
			const files = Array.from(data.files ?? []);
			if (files.length === 0) {
				return false;
			}
			void attachFiles(files);
			return true;
		},
		[attachFiles],
	);

	return {
		activeIndex: safeActiveIndex,
		attachmentError,
		canSend:
			text.trim().length > 0 ||
			segments.some((segment) => segment.kind === 'attachment'),
		autocompleteKind: referenceOpen ? 'entity' : autocomplete.kind,
		clear: () => {
			editorRef.current?.clear();
			setSegments([]);
			setText('');
			setAutocomplete(NO_AUTOCOMPLETE);
		},
		consumeDroppedTransfer,
		consumePastedTransfer,
		editorRef,
		fileInputRef,
		handleDraftChange,
		handleFileInputChange,
		handleKeyDown,
		hasChips: segments.some((segment) => segment.kind === 'attachment'),
		insertDictatedText,
		openFilePicker: () => fileInputRef.current?.click(),
		referenceMatches,
		reportError: setAttachmentError,
		selectReference,
		selectSlashCommand,
		readPrompt: () => serializeComposerDraft({ segments, workspaceCwd: cwd }),
		setActiveIndex,
		slashLoading: catalogue.loading,
		slashMatches,
		startReference,
		text,
	};
}
