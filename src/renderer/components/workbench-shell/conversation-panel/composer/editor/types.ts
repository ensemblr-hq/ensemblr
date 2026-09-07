import type { EditorState } from 'lexical';

import type {
	ComposerAttachment,
	ComposerDraftSegment,
} from '@/renderer/types/workbench';

/** The draft as the editor publishes it after every change. */
export interface ComposerDraftChange {
	/** The chips out of {@link segments}, for consumers that need only the list. */
	attachments: readonly ComposerAttachment[];
	/** Caret position as an offset into `text`. */
	caret: number;
	/** Text runs and chips interleaved, in the order they sit in the document. */
	segments: readonly ComposerDraftSegment[];
	/**
	 * Full document state, for restoring the draft when the composer remounts.
	 * The committed `EditorState` itself rather than its serialization: Lexical
	 * accepts one straight back, so a draft round-trips without the whole
	 * document being serialized on every keystroke.
	 */
	snapshot: EditorState;
	/**
	 * Plain text of the draft, with each chip standing in as one space and a
	 * newline between top-level blocks — so a tray chip contributes its space
	 * plus the newline dividing it from the block after it. Those newlines are
	 * load-bearing for the offsets `segments` and `caret` are measured in; the
	 * prompt serializer trims them back out of each run.
	 */
	text: string;
}

/**
 * The only way to write the composer draft from outside the editor. Every entry
 * point the composer has — a mention pick, a paste, a queued review block, a
 * send that clears the draft — goes through one of these, so Lexical never
 * leaks past the editor folder.
 */
export interface ComposerEditorHandle {
	/** Appends text at the end of the draft, leaving the chips in place. */
	appendText: (text: string) => void;
	/** Empties the draft, chips included. */
	clear: () => void;
	focus: () => void;
	/**
	 * Inserts a chip at the caret, or at the end when the editor is unfocused. A
	 * tray chip ignores the caret and joins the tray above the typed text.
	 */
	insertAttachment: (attachment: ComposerAttachment) => void;
	insertText: (text: string) => void;
	removeAttachment: (id: string) => void;
	/**
	 * Replaces a span of the draft — an `@` token — with a chip. A tray chip
	 * takes the span away and joins the tray instead of standing where it was.
	 */
	replaceRangeWithAttachment: (
		start: number,
		end: number,
		attachment: ComposerAttachment,
	) => void;
	/** Replaces a span of the draft — a `/` token — with text. */
	replaceRangeWithText: (start: number, end: number, text: string) => void;
	/** Restores a whole draft, used to put an unsent one back after a failure. */
	restore: (snapshot: EditorState) => void;
	/** Replaces the whole draft with plain text, dropping any chips. */
	setText: (text: string) => void;
}
