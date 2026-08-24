import { useSetAtom } from 'jotai';
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type RefObject,
	useCallback,
	useRef,
	useState,
} from 'react';

import type { ComposerEditorHandle } from '@/renderer/components/workbench-shell/conversation-panel/composer/editor';
import { PASTE_ATTACHMENT_THRESHOLD } from '@/renderer/hooks/workbench-shell/composer/use-composer-attachments';
import { useSlashCommands } from '@/renderer/hooks/workbench-shell/composer/use-slash-commands';
import { useSlashMatches } from '@/renderer/hooks/workbench-shell/composer/use-slash-matches';
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
	ComposerAttachment,
	ComposerDraftSegment,
	SlashCommandMatch,
} from '@/renderer/types/workbench';
import type { AgentProviderId } from '@/shared/agent-provider';

/** What the Concierge composer's JSX layer needs from its draft state machine. */
export interface ConciergeComposerDraft {
	activeIndex: number;
	attachmentError: string | null;
	/** True when the draft has text or a chip to send. */
	canSend: boolean;
	clear: () => void;
	consumeDroppedTransfer: (data: DataTransfer) => boolean;
	consumePastedTransfer: (data: DataTransfer) => boolean;
	editorRef: RefObject<ComposerEditorHandle | null>;
	handleDraftChange: (change: {
		segments: readonly ComposerDraftSegment[];
		text: string;
	}) => void;
	handleKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
	fileInputRef: RefObject<HTMLInputElement | null>;
	/** Applies the files the hidden input collected. */
	handleFileInputChange: (event: {
		target: { files: FileList | null; value: string };
	}) => void;
	/** Opens the file picker the attachment menu drives. */
	openFilePicker: () => void;
	/** Surfaces a send-path failure on the composer's own error line. */
	reportError: (message: string) => void;
	/** Applies the command a popover row was clicked on. */
	selectSlashCommand: (command: string, autoSubmit: boolean) => void;
	/** Renders the draft — text and chips in document order — as one prompt. */
	readPrompt: () => Promise<string>;
	setActiveIndex: (index: number) => void;
	/** Which autocomplete list is open, if any. */
	slashOpen: boolean;
	slashLoading: boolean;
	slashMatches: readonly SlashCommandMatch[];
	text: string;
}

/** Matches a `/command` token the caret is still inside. */
const SLASH_TOKEN = /(?:^|\s)\/([\w:-]*)$/;

/**
 * Owns the Concierge composer's draft: its segments, its attachments, and its
 * slash-command autocomplete.
 *
 * Everything here is the workspace composer's own machinery pointed at the
 * Concierge home instead of a worktree — `attachPastedFiles` and
 * `serializeComposerDraft` both take a cwd rather than a workspace, and the
 * slash catalogue is resolved per runtime and cwd. What it does not carry is
 * `@` file mentions: those rank against a workspace's file list, and the
 * Concierge has no workspace whose files it would be naming.
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
	const [slashQuery, setSlashQuery] = useState<string | null>(null);
	const [activeIndex, setActiveIndex] = useState(0);

	const slashOpen = slashQuery !== null;
	const catalogue = useSlashCommands(provider, cwd, slashOpen);
	const slashMatches = useSlashMatches(
		catalogue.commands,
		slashQuery ?? '',
		slashOpen,
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
		(change: { segments: readonly ComposerDraftSegment[]; text: string }) => {
			setSegments(change.segments);
			setText(change.text);
			const token = SLASH_TOKEN.exec(change.text);
			setSlashQuery(token ? (token[1] ?? '') : null);
			setActiveIndex(0);
		},
		[],
	);

	const selectSlashCommand = useCallback(
		(command: string, autoSubmit: boolean) => {
			setSlashQuery(null);
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

	const applySlashMatch = useCallback(
		(index: number) => {
			const match = slashMatches[index];
			if (match) {
				selectSlashCommand(match.item.command, match.item.autoSubmit);
			}
		},
		[selectSlashCommand, slashMatches],
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
			if (!slashOpen || slashMatches.length === 0) {
				return;
			}
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				setActiveIndex((index) => (index + 1) % slashMatches.length);
				return;
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				setActiveIndex(
					(index) => (index - 1 + slashMatches.length) % slashMatches.length,
				);
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				setSlashQuery(null);
				return;
			}
			if (event.key === 'Enter' || event.key === 'Tab') {
				event.preventDefault();
				applySlashMatch(activeIndex);
			}
		},
		[activeIndex, applySlashMatch, slashMatches.length, slashOpen],
	);

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
		activeIndex,
		attachmentError,
		canSend:
			text.trim().length > 0 ||
			segments.some((segment) => segment.kind === 'attachment'),
		clear: () => {
			editorRef.current?.clear();
			setSegments([]);
			setText('');
			setSlashQuery(null);
		},
		consumeDroppedTransfer,
		consumePastedTransfer,
		editorRef,
		fileInputRef,
		handleDraftChange,
		handleFileInputChange,
		handleKeyDown,
		openFilePicker: () => fileInputRef.current?.click(),
		reportError: setAttachmentError,
		selectSlashCommand,
		readPrompt: () => serializeComposerDraft({ segments, workspaceCwd: cwd }),
		setActiveIndex,
		slashLoading: catalogue.loading,
		slashMatches,
		slashOpen,
		text,
	};
}
