import type { TFunction } from 'i18next';

import { APP_FAILURE_TEXT, type AppFailureCode } from './codes';

export type { AppFailureCode } from './codes';

/**
 * The shape every main-process diagnostic and failure shares: a stable code the
 * renderer translates, and the English sentence main built for the support
 * bundle.
 */
export interface CodedFailure {
	code: string;
	message: string;
	/**
	 * The command's own stderr, when the failure came from one and it wrote any.
	 * Distinct from `message`, which falls back to prose main wrote and so is
	 * never safe to render as the command's words.
	 */
	output?: string;
}

/**
 * Translates a main-process failure into the app's language, falling back to
 * the English message main sent when the code is one this table does not carry
 * — a runtime the union does not cover, or a payload from an older build.
 * @param t - Translator bound to the active language
 * @param failure - The coded failure main reported, or null/undefined
 * @returns The headline to show, or null when there is no failure
 */
export function failureText(
	t: TFunction,
	failure: CodedFailure | null | undefined,
): string | null {
	if (!failure) {
		return null;
	}
	const authored = APP_FAILURE_TEXT[failure.code as AppFailureCode];
	return authored ? authored(t) : failure.message;
}

/**
 * Characters main's message only carries once runtime data has been spliced
 * into it: a path separator, a quoted name, a shell fragment, a home-relative
 * path, a count or exit code, git's multi-line stderr. Authored English prose
 * carries none of them, which is what tells a message worth showing apart from
 * one that merely restates the headline in a language the reader may not have.
 */
const RUNTIME_SPECIFICS = /[/"`~\n]|\d/;

/**
 * The runtime specifics main's own message carries that a code cannot — a
 * branch name, a path, git's stderr. Diagnostic rows show it under the
 * translated headline.
 *
 * Main's message is the support-bundle English and is never translated, so it
 * is only worth putting on screen when it says something the headline could
 * not. Most of main's sentences say the same thing in different words; those
 * would read as an untranslated second line in every locale, so they are
 * dropped and only the ones carrying substituted data survive.
 * @param t - Translator bound to the active language
 * @param failure - The coded failure main reported
 * @returns The English detail line, or null when there is nothing to add
 */
export function failureDetail(
	t: TFunction,
	failure: CodedFailure,
): string | null {
	if (!APP_FAILURE_TEXT[failure.code as AppFailureCode]) {
		return null;
	}
	const message = failure.message.trim();
	if (!message || message === failureText(t, failure)) {
		return null;
	}
	return RUNTIME_SPECIFICS.test(message) ? message : null;
}
