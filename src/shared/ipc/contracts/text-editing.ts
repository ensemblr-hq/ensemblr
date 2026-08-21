import type { TextEditCommand } from '../../text-edit-commands';

/**
 * What Chromium knows about the spot the user right-clicked, forwarded from the
 * main process so the renderer can draw the menu itself. Everything here comes
 * from one `context-menu` event: the renderer cannot derive the spellchecker's
 * verdict, and its own guesses at selection and editability are worse than
 * Chromium's answers.
 */
export interface TextContextMenuTarget {
	canCopy: boolean;
	canCut: boolean;
	canPaste: boolean;
	canRedo: boolean;
	canSelectAll: boolean;
	canUndo: boolean;
	/** Corrections for {@link TextContextMenuTarget.misspelledWord}, best first. */
	dictionarySuggestions: readonly string[];
	isEditable: boolean;
	/** The misspelled word under the cursor, empty when there is none. */
	misspelledWord: string;
	/**
	 * Chromium's copy of the selection, capped at the kilobyte a menu needs. It
	 * drives the disabled states; a clipboard payload has to come from the live
	 * DOM selection instead, or a long copy silently loses its tail.
	 */
	selectionText: string;
	/** Viewport coordinates of the click in CSS pixels, used to anchor the menu. */
	x: number;
	y: number;
}

/** Request to swap the misspelled word under the cursor for a correction. */
export interface ReplaceMisspellingRequest {
	replacement: string;
}

/** Request to teach the spellchecker a word it currently flags. */
export interface AddWordToDictionaryRequest {
	word: string;
}

/** Clipboard, history, and spellcheck operations for the text context menu. */
export interface TextEditingApi {
	addWordToDictionary: (request: AddWordToDictionaryRequest) => Promise<void>;
	onTextContextMenu: (
		listener: (payload: TextContextMenuTarget) => void,
	) => () => void;
	replaceMisspelling: (request: ReplaceMisspellingRequest) => Promise<void>;
	runTextEditCommand: (command: TextEditCommand) => Promise<void>;
}
