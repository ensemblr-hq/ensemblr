/**
 * Pure helper that turns a user's first prompt into a provisional branch slug,
 * so a Plan Mode workspace stops carrying its generated placeholder name before
 * the agent has read a single file.
 *
 * `sanitizeBranchSlug` alone is not enough here: it normalizes a whole line and
 * caps it at 40 characters, so a conversational prompt slugs to
 * `i-d-like-to-make-and-adjustments-to-tab`. This module trims the opening
 * pleasantry, drops the connective words that carry no meaning in a branch name,
 * and caps by word count instead — which is what makes the result readable in a
 * sidebar. Kept free of the pi/sqlite runtime so it unit-tests under Vitest
 * alongside its siblings.
 */

import { sanitizeBranchSlug } from '../branch-name-slug.ts';
import { deriveTitleSource } from './derive-title-source.ts';
import { firstContentLine } from './first-content-line.ts';

const MAX_SLUG_WORDS = 5;

/**
 * Openers that name the user's manner of asking rather than the work. Matched
 * repeatedly from the start of the prompt, so "ok so can you please add X"
 * reduces to "add X".
 */
const LEADING_FILLER =
	/^(?:i'?d\s+like\s+to|i\s+would\s+like\s+to|i\s+want\s+to|i\s+need\s+to|i\s+wanna|can\s+you|could\s+you|would\s+you|will\s+you|let'?s|we\s+should|we\s+need\s+to|we\s+want\s+to|please|basically|actually|maybe|hey|hi|ok(?:ay)?|so|now|also|just|kindly|help\s+me)\b[\s,:-]*/i;

/**
 * Words that survive normalization but say nothing about the work. Dropped only
 * when something is left over, so a prompt made entirely of them still yields a
 * slug rather than nothing.
 */
const STOP_WORDS = new Set([
	'a',
	'an',
	'and',
	'are',
	'as',
	'at',
	'be',
	'by',
	'for',
	'from',
	'in',
	'into',
	'is',
	'it',
	'of',
	'on',
	'or',
	'that',
	'the',
	'these',
	'this',
	'those',
	'to',
	'with',
]);

/**
 * Derives the slug a Plan Mode workspace should carry until the agent picks a
 * better one. Runs the prompt through the same scaffolding and slash-command
 * stripping the deterministic tab titler uses, so both names describe the typed
 * message rather than the composer's wrapper.
 * @param prompt - The raw persisted or composed first user prompt.
 * @returns A kebab-case slug of at most five words, or null when the prompt carried no usable words.
 */
export function deriveProvisionalBranchSlug(prompt: string): string | null {
	const typed = firstContentLine(deriveTitleSource(prompt));
	if (!typed) {
		return null;
	}
	const words = toWords(stripLeadingFiller(typed));
	if (words.length === 0) {
		return null;
	}
	return sanitizeBranchSlug(capWords(words).join(' '));
}

/**
 * Removes stacked opening pleasantries from the front of a prompt.
 * @param text - The prompt's first content line.
 * @returns The text with every leading filler phrase consumed.
 */
function stripLeadingFiller(text: string): string {
	let remaining = text.trim();
	while (LEADING_FILLER.test(remaining)) {
		const stripped = remaining.replace(LEADING_FILLER, '').trim();
		if (stripped === remaining || stripped.length === 0) {
			return remaining;
		}
		remaining = stripped;
	}
	return remaining;
}

/**
 * Reduces text to the lowercase alphanumeric words a slug can be built from.
 * @param text - The filler-stripped prompt text.
 * @returns The words, in order, with punctuation discarded.
 */
function toWords(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.split(' ')
		.filter((word) => word.length > 0);
}

/**
 * Takes the leading words that describe the work, preferring the ones that carry
 * meaning but never returning an empty list.
 * @param words - Every word the prompt yielded.
 * @returns At most {@link MAX_SLUG_WORDS} words.
 */
function capWords(words: string[]): string[] {
	const meaningful = words.filter((word) => !STOP_WORDS.has(word));
	const source = meaningful.length > 0 ? meaningful : words;
	return source.slice(0, MAX_SLUG_WORDS);
}
