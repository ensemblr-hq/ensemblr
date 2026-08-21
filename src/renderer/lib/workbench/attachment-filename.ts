/**
 * How a human label becomes the filename an attachment is stored under, so the
 * chip's stored file and the agent's `<attached_file path>` name the thing the
 * content came from rather than a hash.
 *
 * Every name produced here is re-sanitized in the main process by
 * `sanitizeAttachmentStem` (`src/main/workspace-files/context-attachments.ts`),
 * which keeps only `[a-z0-9_-]` — so a stem that does not already survive that
 * character set is destroyed on the way to disk, whatever this module sends.
 */

/** Characters a filename stem can carry; anything else is lost to sanitizing. */
const STEM_SAFE_LABEL = /^[a-z0-9_ -]*$/i;

/** Stem used for a terminal whose pane has no name of its own. */
const UNNAMED_TERMINAL_STEM = 'terminal';

/** How many hex characters of a label's digest disambiguate a lossy stem. */
const LABEL_DIGEST_CHARS = 8;

/**
 * Reduces a human label to the conservative stem a filename can carry.
 * @param label - The label to name a file after
 * @returns The sanitized stem, empty when the label held nothing usable
 */
export function filenameStem(label: string): string {
	return label
		.trim()
		.toLowerCase()
		.replaceAll(/[^a-z0-9_-]+/g, '-')
		.replaceAll(/^-+|-+$/g, '');
}

/**
 * A short digest of a label, standing in for the characters sanitizing threw
 * away so two labels that reduce to the same stem still reach different files.
 * @param label - The raw label being named after
 * @returns The opening hex characters of the label's SHA-256
 */
async function labelDigest(label: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(label),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, '0'),
	)
		.join('')
		.slice(0, LABEL_DIGEST_CHARS);
}

/**
 * Builds the filename a terminal selection is stored under, naming the pane it
 * was taken off. The store is content-addressed by payload alone, so this is
 * also what keeps two identical selections from different terminals apart:
 * same hash folder, different files, one chip each.
 *
 * A pane's name is a translated string — `Запуск`, `Εκτέλεση` — and sanitizing
 * one to `[a-z0-9_-]` empties it, which would file every pane under one name and
 * collapse two panes' identical output into a single chip. A label that cannot
 * survive the stem alphabet therefore carries a digest of itself, which stays
 * distinct per pane in every language.
 * @param label - What the terminal pane calls itself
 * @returns A conservative filename stem plus its `.txt` extension
 */
export async function terminalSelectionFilename(
	label: string,
): Promise<string> {
	const trimmed = label.trim();
	const stem = filenameStem(trimmed) || UNNAMED_TERMINAL_STEM;
	if (STEM_SAFE_LABEL.test(trimmed)) {
		return `${stem}-selection.txt`;
	}
	return `${stem}-${await labelDigest(trimmed)}-selection.txt`;
}
