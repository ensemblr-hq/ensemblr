/** Punctuation that attaches to the preceding word rather than starting a new one. */
const TRAILING_PUNCTUATION = new Set([
	'!',
	')',
	',',
	'.',
	':',
	';',
	'?',
	']',
	'}',
]);

/**
 * Decides what to insert at the caret so a dictated phrase reads as prose
 * against whatever is already in the draft.
 *
 * Dictation lands mid-sentence far more often than it lands in an empty
 * composer, and a transcript carries no leading space of its own — inserting it
 * raw yields "the bugin the parser". A space is prepended unless the character
 * before the caret is already whitespace, the caret sits at the very start, or
 * the transcript opens with punctuation that belongs to the previous word.
 *
 * @param textBeforeCaret - Draft text to the left of the caret
 * @param transcript - The transcribed phrase, already trimmed
 * @returns The string to insert at the caret
 */
export function joinDictatedText(
	textBeforeCaret: string,
	transcript: string,
): string {
	const phrase = transcript.trim();

	if (!phrase) {
		return '';
	}

	const previousCharacter = textBeforeCaret.slice(-1);
	const needsSpace =
		previousCharacter !== '' &&
		!/\s/.test(previousCharacter) &&
		!TRAILING_PUNCTUATION.has(phrase[0] ?? '');

	return needsSpace ? ` ${phrase}` : phrase;
}
