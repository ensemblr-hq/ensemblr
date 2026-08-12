import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai';
import type { EditorState } from 'lexical';
import {
	type ChangeEvent,
	type DragEvent as ReactDragEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from 'react';
import type {
	ComposerDraftChange,
	ComposerEditorHandle,
} from '@/renderer/components/workbench-shell/conversation-panel/composer/editor';
import { useComposerAttachments } from '@/renderer/hooks/workbench-shell/composer/use-composer-attachments';
import { useComposerAutocomplete } from '@/renderer/hooks/workbench-shell/composer/use-composer-autocomplete';
import { useComposerKeymap } from '@/renderer/hooks/workbench-shell/composer/use-composer-keymap';
import { useComposerSubmit } from '@/renderer/hooks/workbench-shell/composer/use-composer-submit';
import { useIssueAttachments } from '@/renderer/hooks/workbench-shell/composer/use-issue-attachments';
import { useLinkedDirectories } from '@/renderer/hooks/workbench-shell/composer/use-linked-directories';
import { resolveSendIntent } from '@/renderer/lib/workbench';
import {
	composerAttachmentsAtomFamily,
	composerEditorStateAtomFamily,
	composerValueAtomFamily,
	useComposerInsertConsumer,
} from '@/renderer/state/composer';
import { sendShortcutAtom } from '@/renderer/state/preferences';
import type {
	AutocompleteKind,
	AutocompleteState,
	ComposerAttachment,
	ComposerDraftSegment,
	ComposerSendIntent,
	ComposerShellState,
	LinkedDirectory,
	MentionMatch,
	QueuedFollowUp,
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
	/** Clears every entry this chat has queued. */
	clearQueue: () => void;
	/** Messages waiting for the current turn to end, in the order they will send. */
	followUpQueue: readonly QueuedFollowUp[];
	/** Sends the head of a stalled queue now, resuming automatic draining with it. */
	flushQueueNow: () => void;
	/**
	 * True while the queue is waiting on the user rather than on the agent: after
	 * a stop or a failed flush, or once a `block`-mode queue outlives its turn.
	 */
	queueStalled: boolean;
	/** Moves a queued entry one place towards the front or the back. */
	moveQueued: (id: string, direction: 'down' | 'up') => void;
	/** Drops one queued entry without sending it. */
	removeQueued: (id: string) => void;
	/** Applies an explicit queue order, which is what a drag hands back. */
	reorderQueue: (orderedIds: readonly string[]) => void;
	/** Takes a queued entry back into the composer to edit, chips and all. */
	restoreQueued: (id: string) => void;
	/** What pressing Send would do right now: send, queue, or hold. */
	sendIntent: ComposerSendIntent;
	autocomplete: AutocompleteState;
	autocompleteActive: boolean;
	autocompleteKind: AutocompleteKind;
	autocompleteTotal: number;
	canSubmit: boolean;
	/** True when a send is allowed even while the agent is working (steer / follow-up). */
	canSend: boolean;
	/** Takes over a paste the editor should not inline; true when it did. */
	consumePastedTransfer: (data: DataTransfer) => boolean;
	/** Takes over a drop onto the editor; true when it carried files. */
	consumeDroppedTransfer: (data: DataTransfer) => boolean;
	dismissAutocomplete: () => void;
	/** The one way to write the draft; null until the editor has mounted. */
	editorRef: RefObject<ComposerEditorHandle | null>;
	fileInputRef: RefObject<HTMLInputElement | null>;
	handleAddAttachment: () => void;
	handleDraftChange: (change: ComposerDraftChange) => void;
	handleDragOver: (event: ReactDragEvent<HTMLElement>) => void;
	handleDrop: (event: ReactDragEvent<HTMLElement>) => void;
	handleFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
	handleKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
	/** Stops the running turn and pauses the queue rather than draining into the gap. */
	handleStop: () => Promise<void>;
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
	/** The draft the editor opens with when it mounts onto an existing chat. */
	initialDraft: {
		attachments: readonly ComposerAttachment[];
		snapshot: EditorState | null;
		text: string;
	};
	value: string;
}

/**
 * The draft as it reads before the editor has published one: the typed text
 * followed by its chips. Stands in only for the window between a draft being
 * seeded into the atoms and the editor mounting onto it, since nothing outside
 * the editor records where in the sentence a chip sat.
 * @param text - The mirrored draft text
 * @param attachments - The mirrored chip list
 * @returns The draft's segments, text first
 */
function flatDraftSegments(
	text: string,
	attachments: readonly ComposerAttachment[],
): readonly ComposerDraftSegment[] {
	return [
		...(text.length > 0 ? [{ kind: 'text' as const, text }] : []),
		...attachments.map((attachment) => ({
			attachment,
			kind: 'attachment' as const,
		})),
	];
}

/**
 * Whether two chip lists stand for the same attachments in the same order. The
 * editor republishes a freshly built list on every keystroke, so without this
 * every character would hand the mirror atom a new identity and re-render
 * everything reading it.
 * @param left - The chip list currently mirrored
 * @param right - The chip list the editor just published
 * @returns True when both hold the same ids in the same order
 */
function sameAttachments(
	left: readonly ComposerAttachment[],
	right: readonly ComposerAttachment[],
): boolean {
	return (
		left.length === right.length &&
		left.every((attachment, index) => attachment.id === right[index]?.id)
	);
}

/**
 * What an external write added to the end of the draft, or null when it
 * replaced the draft outright. The mirror's trailing whitespace need not
 * survive the comparison: a chip reads as a trailing space and the surfaces
 * that append trim the draft's end first, so an append would otherwise look
 * like a replacement and take every chip with it.
 * @param mirrored - The draft text as the editor last published it
 * @param value - The draft text the atom now holds
 * @returns The appended suffix, or null when the draft was replaced
 */
export function appendedSuffix(mirrored: string, value: string): string | null {
	if (value.startsWith(mirrored)) {
		return value.slice(mirrored.length);
	}
	const trimmed = mirrored.trimEnd();
	return value.startsWith(trimmed) ? value.slice(trimmed.length) : null;
}

/**
 * The draft a slash-command auto-submit sends: the chips the user attached, in
 * the order they sit in the sentence, followed by the command. The rest of the
 * draft is whitespace — a pick only auto-submits when nothing else was typed.
 * @param segments - The live draft's segments
 * @param command - The slash command being submitted, leading slash included
 * @returns The draft to dispatch
 */
function slashCommandDraft(
	segments: readonly ComposerDraftSegment[],
	command: string,
) {
	return {
		segments: [
			...segments.filter((segment) => segment.kind === 'attachment'),
			{ kind: 'text' as const, text: command },
		],
		text: command,
	};
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
	const editorRef = useRef<ComposerEditorHandle | null>(null);
	const anchorRef = useRef<HTMLDivElement | null>(null);
	const store = useStore();

	const [value, setValue] = useAtom(composerValueAtomFamily(chatTabId));
	const setAttachments = useSetAtom(composerAttachmentsAtomFamily(chatTabId));
	const setEditorState = useSetAtom(composerEditorStateAtomFamily(chatTabId));

	// Read once per mount, which is once per chat because `ComposerPanel` keys its
	// body by chat tab: the editor takes ownership of the draft from here on,
	// and re-reading would fight the mirror it publishes back into these atoms. The
	// segments are seeded flat and replaced by the real interleaving the moment
	// the editor mounts and publishes — only the editor knows where in the
	// sentence the chips sit, and until it is up all the atoms carry is text
	// plus a chip list.
	const [initialState] = useState(() => {
		const attachments = store.get(composerAttachmentsAtomFamily(chatTabId));
		const text = store.get(composerValueAtomFamily(chatTabId));
		return {
			draft: {
				attachments,
				snapshot: store.get(composerEditorStateAtomFamily(chatTabId)),
				text,
			},
			segments: flatDraftSegments(text, attachments),
		};
	});
	const initialDraft = initialState.draft;
	const mirroredTextRef = useRef(initialDraft.text);
	const snapshotRef = useRef<EditorState | null>(initialDraft.snapshot);
	const segmentsRef = useRef<readonly ComposerDraftSegment[]>(
		initialState.segments,
	);
	// Read through a callback rather than handed over at render time, so a send
	// always serializes the draft the editor holds now. A publish that changes
	// neither the text nor the chip list does not re-render, and a snapshot taken
	// at render would then be one edit behind.
	const readDraft = useCallback(
		() => ({
			segments: segmentsRef.current,
			snapshot: snapshotRef.current,
			text: mirroredTextRef.current,
		}),
		[],
	);

	const insertText = useCallback((text: string) => {
		const editor = editorRef.current;
		if (!editor) {
			return;
		}
		const separator = mirroredTextRef.current.trim().length > 0 ? '\n\n' : '';
		editor.appendText(`${separator}${text}`);
		editor.focus();
	}, []);

	const {
		addAttachments,
		attachmentError,
		attachments,
		consumeDroppedTransfer,
		consumePastedTransfer,
		fileInputRef,
		handleAddAttachment,
		handleDragOver,
		handleDrop,
		handleFileChange,
		hasChips,
		removeAttachment,
		setAttachmentError,
	} = useComposerAttachments({
		chatTabId,
		editorRef,
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
		dispatchSubmit,
		flushQueueNow,
		handleStop,
		followUp,
		handleSubmit,
		pending,
		queue,
		queueCurrent,
		queueStalled,
		restoreQueued,
	} = useComposerSubmit({
		chatTabId,
		composer,
		editorRef,
		readDraft,
		setAttachmentError,
	});

	const {
		activeIndex,
		autocomplete,
		autocompleteActive,
		autocompleteKind,
		autocompleteTotal,
		confirmAutocomplete,
		dismissAutocomplete,
		mentionMatches,
		onMentionSelect,
		onSlashSelect,
		setActiveIndex,
		slashLoading,
		slashMatches,
		stepActive,
		updateAutocomplete,
	} = useComposerAutocomplete({
		composer,
		editorRef,
		onSubmitSlashCommand: (command) =>
			dispatchSubmit(slashCommandDraft(segmentsRef.current, command)),
		setAttachmentError,
		value,
	});

	/**
	 * Mirrors the editor's draft into the atoms the rest of the app reads, and
	 * re-detects the token under the caret. The editor owns the draft; these
	 * atoms are a read model, so nothing else may write them while it is mounted.
	 */
	const handleDraftChange = useCallback(
		(change: ComposerDraftChange) => {
			mirroredTextRef.current = change.text;
			snapshotRef.current = change.snapshot;
			segmentsRef.current = change.segments;
			setValue(change.text);
			setAttachments((current) =>
				sameAttachments(current, change.attachments)
					? current
					: change.attachments,
			);
			setEditorState(change.snapshot);
			updateAutocomplete(change.text, change.caret);
		},
		[setAttachments, setEditorState, setValue, updateAutocomplete],
	);

	// Surfaces outside the composer — the diff viewer's "Add to chat", a plan
	// handoff — write the draft atom for a tab that may not be mounted. Fold an
	// append into the document rather than letting the two states drift.
	useEffect(() => {
		if (value === mirroredTextRef.current) {
			return;
		}
		const editor = editorRef.current;
		if (!editor) {
			return;
		}
		const appended = appendedSuffix(mirroredTextRef.current, value);
		mirroredTextRef.current = value;
		if (appended === null) {
			editor.setText(value);
			return;
		}
		editor.appendText(appended);
	}, [value]);

	const sendShortcut = useAtomValue(sendShortcutAtom);

	const handleKeyDown = useComposerKeymap({
		autocompleteKind,
		canConfirmAutocomplete: autocompleteActive,
		onConfirmAutocomplete: confirmAutocomplete,
		onDismissAutocomplete: dismissAutocomplete,
		onQueue: queueCurrent,
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
	// Live mid-turn under every behavior: each one now has somewhere for the draft
	// to go, and the send tooltip names which.
	const canSend = !composer.disabled && !pending && hasContent;
	const sendIntent = resolveSendIntent(followUp, composer.isStreaming);

	return {
		clearQueue: queue.clear,
		followUpQueue: queue.entries,
		flushQueueNow,
		moveQueued: queue.move,
		queueStalled,
		removeQueued: queue.remove,
		reorderQueue: queue.reorder,
		restoreQueued,
		sendIntent,
		activeIndex,
		anchorRef,
		attachGithubIssue,
		attachLinearIssue,
		attachmentError,
		attachments,
		autocomplete,
		autocompleteActive,
		autocompleteKind,
		autocompleteTotal,
		canSubmit,
		canSend,
		consumeDroppedTransfer,
		consumePastedTransfer,
		dismissAutocomplete,
		editorRef,
		fileInputRef,
		handleAddAttachment,
		handleDraftChange,
		handleDragOver,
		handleDrop,
		handleFileChange,
		handleKeyDown,
		handleStop,
		handleSubmit,
		hasChips,
		hasContent,
		initialDraft,
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
		unlinkDirectory,
		value,
	};
}
