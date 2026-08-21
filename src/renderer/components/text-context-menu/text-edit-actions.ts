import type { TextEditCommand } from '@/shared/text-edit-commands';

/** Elements an edit command can land on once focus is restored to them. */
const EDITABLE_SELECTOR = '[contenteditable="true"], input, textarea';

/**
 * Finds the field the user right-clicked, so a command can be aimed back at it
 * after the menu has taken and released focus. Chromium's `isEditable` says an
 * editable spot was clicked; this says which element it was. Takes the element
 * already hit-tested for the scope check rather than the point, so one
 * right-click costs one `elementFromPoint`.
 * @param hit - The element under the click
 * @returns The editable element containing the hit, or null when there is none
 */
export function findEditableIn(hit: Element | null): HTMLElement | null {
	return hit?.closest<HTMLElement>(EDITABLE_SELECTOR) ?? null;
}

/**
 * Selects everything inside a container, which is what "Select all" means on a
 * read-only surface — the transcript the user right-clicked, not the whole
 * window the native command would take.
 * @param container - Element whose contents become the selection
 */
export function selectContentsOf(container: HTMLElement): void {
	const selection = window.getSelection();

	if (!selection) {
		return;
	}

	const range = document.createRange();
	range.selectNodeContents(container);
	selection.removeAllRanges();
	selection.addRange(range);
}

/**
 * Writes text to the clipboard, logging a denied or unavailable clipboard
 * rather than throwing at the caller.
 * @param text - The text to place on the clipboard
 */
export async function copyText(text: string): Promise<void> {
	if (text.length === 0) {
		return;
	}

	try {
		await navigator.clipboard.writeText(text);
	} catch (error) {
		console.error('Failed to copy the selection to the clipboard:', error);
	}
}

/**
 * Asks the main process to run one edit command against this window. Requires
 * the caller to have already focused the field the command should land on.
 * @param command - The clipboard or history command to run
 */
export async function runTextEditCommand(
	command: TextEditCommand,
): Promise<void> {
	try {
		await window.ensemblr?.runTextEditCommand(command);
	} catch (error) {
		console.error(`Failed to run the "${command}" edit command:`, error);
	}
}

/**
 * Swaps the misspelled word under the cursor for a correction. Requires the
 * caller to have already focused the field holding it.
 * @param replacement - The correction to type in its place
 */
export async function replaceMisspelling(replacement: string): Promise<void> {
	try {
		await window.ensemblr?.replaceMisspelling({ replacement });
	} catch (error) {
		console.error('Failed to apply the spelling correction:', error);
	}
}

/**
 * Teaches the spellchecker a word so it stops being flagged, for this user's
 * profile rather than this window.
 * @param word - The word to add to the dictionary
 */
export async function addWordToDictionary(word: string): Promise<void> {
	try {
		await window.ensemblr?.addWordToDictionary({ word });
	} catch (error) {
		console.error('Failed to add the word to the dictionary:', error);
	}
}
