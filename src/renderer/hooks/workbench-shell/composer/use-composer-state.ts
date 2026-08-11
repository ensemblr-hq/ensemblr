import { useAtom, useAtomValue } from 'jotai';
import {
	type ChangeEvent,
	type ClipboardEvent as ReactClipboardEvent,
	type DragEvent as ReactDragEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
} from 'react';
import { useComposerAttachments } from '@/renderer/hooks/workbench-shell/composer/use-composer-attachments';
import { useComposerAutocomplete } from '@/renderer/hooks/workbench-shell/composer/use-composer-autocomplete';
import { useComposerKeymap } from '@/renderer/hooks/workbench-shell/composer/use-composer-keymap';
import { useComposerSubmit } from '@/renderer/hooks/workbench-shell/composer/use-composer-submit';
import { useIssueAttachments } from '@/renderer/hooks/workbench-shell/composer/use-issue-attachments';
import { useLinkedDirectories } from '@/renderer/hooks/workbench-shell/composer/use-linked-directories';
import {
	composerValueAtomFamily,
	useComposerInsertConsumer,
} from '@/renderer/state/composer';
import { sendShortcutAtom } from '@/renderer/state/preferences';
import type {
	AutocompleteKind,
	AutocompleteState,
	ComposerAttachment,
	ComposerShellState,
	LinkedDirectory,
	MentionMatch,
	SlashCommandMatch,
	WorkspaceFileSummary,
} from '@/renderer/types/workbench';
import type { LinearIssueWire } from '@/shared/ipc/contracts/linear';
import type { RecordLinkedDirectoryFailureCode } from '@/shared/ipc/contracts/linked-directories';
import type { RepositoryIssueWire } from '@/shared/ipc/contracts/workspace-sources';

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
	/** Everything the draft carries alongside its text, in the order it was added. */
	attachments: readonly ComposerAttachment[];
	/** Writes a GitHub issue out as a markdown document and attaches it. */
	attachGithubIssue: (issue: RepositoryIssueWire) => Promise<void>;
	/** Writes a Linear issue (with its comments) out and attaches it. */
	attachLinearIssue: (issue: LinearIssueWire) => Promise<void>;
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
	/** True when a send is allowed even while the agent is working (steer / follow-up). */
	canSend: boolean;
	dismissAutocomplete: () => void;
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
	/** True when the composer holds any draft text or attachment. */
	hasContent: boolean;
	insertText: (text: string) => void;
	isStreaming: boolean;
	/** Grants this chat's agent access to a directory outside the workspace. */
	linkDirectory: (
		path: string,
	) => Promise<RecordLinkedDirectoryFailureCode | null>;
	/** Directories outside the workspace this chat may read, sticky across sends. */
	linkedDirectories: readonly LinkedDirectory[];
	/** Linked after the runtime session opened, so not readable until it reopens. */
	pendingLinkedDirectories: readonly LinkedDirectory[];
	unlinkDirectory: (path: string) => void;
	/** Send the current draft to the agent as a follow-up (Cmd+J). */
	queueCurrent: () => void;
	mentionMatches: readonly MentionMatch[];
	onMentionSelect: (entry: WorkspaceFileSummary) => void;
	onSlashSelect: (command: string, autoSubmit: boolean) => void;
	pending: boolean;
	removeAttachment: (id: string) => void;
	setActiveIndex: (index: number) => void;
	/** True while the runtime is still being asked for its command catalogue. */
	slashLoading: boolean;
	slashMatches: readonly SlashCommandMatch[];
	textareaRef: RefObject<HTMLTextAreaElement | null>;
	value: string;
}

/**
 * Owns the composer's local state machine: textarea value, mention + slash
 * autocomplete, the ordered attachment list, keymap bindings, and the submit
 * pipeline that serializes attachments into the outgoing prompt. Returns a
 * stable shape so the parent component is a thin JSX orchestrator.
 *
 * The submit pipeline inlines attachment content into the prompt text so the
 * existing `prompt: string` IPC contract stays untouched.
 */
export function useComposerState({
	chatTabId,
	composer,
	seedText,
}: UseComposerStateArgs): ComposerStateApi {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const anchorRef = useRef<HTMLDivElement | null>(null);

	const [value, setValue] = useAtom(composerValueAtomFamily(chatTabId));

	const insertText = useCallback(
		(text: string) => {
			setValue((current) =>
				current.trim().length > 0 ? `${current.trimEnd()}\n\n${text}` : text,
			);
			textareaRef.current?.focus();
		},
		[setValue],
	);

	const {
		addAttachments,
		attachmentError,
		attachments,
		fileInputRef,
		handleAddAttachment,
		handleDragOver,
		handleDrop,
		handleFileChange,
		handlePaste,
		hasChips,
		removeAttachment,
		setAttachmentError,
		setAttachments,
	} = useComposerAttachments({
		chatTabId,
		insertPlainText: insertText,
		workspaceCwd: composer.workspaceCwd,
	});

	const {
		linkDirectory,
		linkedDirectories,
		pendingDirectories,
		unlinkDirectory,
	} = useLinkedDirectories({ chatTabId });

	const { attachGithubIssue, attachLinearIssue } = useIssueAttachments({
		addAttachments,
		setAttachmentError,
		workspaceCwd: composer.workspaceCwd,
	});

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

	const {
		blockedNotice,
		dispatchSubmit,
		followUp,
		handleSubmit,
		pending,
		queueCurrent,
		setBlockedNotice,
	} = useComposerSubmit({
		chatTabId,
		composer,
		draft: { attachments, text: value },
		setAttachmentError,
		setAttachments,
		setValue,
	});

	const {
		activeIndex,
		autocomplete,
		autocompleteActive,
		autocompleteKind,
		autocompleteTotal,
		confirmAutocomplete,
		dismissAutocomplete,
		handleSelect,
		mentionMatches,
		onMentionSelect,
		onSlashSelect,
		setActiveIndex,
		slashLoading,
		slashMatches,
		stepActive,
		updateAutocomplete,
	} = useComposerAutocomplete({
		addAttachments,
		composer,
		onSubmitSlashCommand: (text) => dispatchSubmit({ attachments, text }),
		setAttachmentError,
		setValue,
		textareaRef,
		value,
	});

	const handleChange = useCallback(
		(event: ChangeEvent<HTMLTextAreaElement>) => {
			const nextValue = event.target.value;
			setValue(nextValue);
			setBlockedNotice(false);
			const caret = event.target.selectionStart ?? nextValue.length;
			updateAutocomplete(nextValue, caret);
		},
		[updateAutocomplete, setValue, setBlockedNotice],
	);

	const sendShortcut = useAtomValue(sendShortcutAtom);

	const removeLastMention = useCallback(() => {
		setAttachments((prev) => prev.slice(0, -1));
	}, [setAttachments]);

	const handleKeyDown = useComposerKeymap({
		autocompleteKind,
		canConfirmAutocomplete: autocompleteActive,
		canRemoveLastMention: value.length === 0 && attachments.length > 0,
		onConfirmAutocomplete: confirmAutocomplete,
		onDismissAutocomplete: dismissAutocomplete,
		onQueue: queueCurrent,
		onRemoveLastMention: removeLastMention,
		onStepActiveIndex: stepActive,
		onSubmit: () => {
			void handleSubmit();
		},
		submitsOnBareEnter: sendShortcut !== 'mod+enter',
	});

	const isStreaming = composer.isStreaming || pending;
	const hasContent = value.trim().length > 0 || attachments.length > 0;
	// A normal (idle) send: enabled only when nothing is streaming.
	const canSubmit = !composer.disabled && !isStreaming && hasContent;
	// A send that is valid even mid-turn (steer / follow-up). Lets the composer
	// keep showing an enabled Send button while the agent works so a drafted follow-up
	// is deliverable instead of being hidden behind the Stop button. Under the
	// `block` follow-up mode a mid-turn send would only surface the blocked
	// notice, so the button stays disabled rather than presenting an enabled
	// control that no-ops.
	const canSend =
		!composer.disabled &&
		!pending &&
		hasContent &&
		!(composer.isStreaming && followUp === 'block');

	return {
		activeIndex,
		anchorRef,
		attachGithubIssue,
		attachLinearIssue,
		attachmentError,
		attachments,
		blockedNotice,
		autocomplete,
		autocompleteActive,
		autocompleteKind,
		autocompleteTotal,
		canSubmit,
		canSend,
		dismissAutocomplete,
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
		hasContent,
		insertText,
		isStreaming,
		linkDirectory,
		linkedDirectories,
		mentionMatches,
		onMentionSelect,
		onSlashSelect,
		pending,
		pendingLinkedDirectories: pendingDirectories,
		queueCurrent,
		removeAttachment,
		setActiveIndex,
		slashLoading,
		slashMatches,
		textareaRef,
		unlinkDirectory,
		value,
	};
}
