import { z } from 'zod';

import { TEXT_EDIT_COMMANDS } from '../../../shared/text-edit-commands';

/** Longest word or correction the spellchecker ops accept, as a sanity bound. */
const MAX_SPELLCHECK_TERM_LENGTH = 256;

/**
 * Validates the edit command a renderer context menu asks the main process to
 * run. Strict: an unrecognized command throws back at the caller rather than
 * silently doing nothing, because every value the renderer can send comes from
 * the same shared table and a mismatch means the two sides have drifted.
 */
export const textEditCommandSchema = z.enum(TEXT_EDIT_COMMANDS);

/**
 * Validates a spellcheck correction. The replacement is typed into the focused
 * field, so it is bounded and refused when blank rather than silently wiping
 * the word it replaces.
 */
export const replaceMisspellingRequestSchema = z.object({
	replacement: z.string().min(1).max(MAX_SPELLCHECK_TERM_LENGTH),
});

/**
 * Validates a word added to the spellchecker dictionary. The entry persists in
 * the user's profile, so a blank or unbounded value must not reach the session.
 */
export const addWordToDictionaryRequestSchema = z.object({
	word: z.string().min(1).max(MAX_SPELLCHECK_TERM_LENGTH),
});
