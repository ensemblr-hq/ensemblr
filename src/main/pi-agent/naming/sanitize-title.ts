/**
 * Pure helpers for normalizing an LLM-generated chat-tab title. Kept free of the
 * pi/sqlite runtime so the full sanitization contract unit-tests under Vitest.
 */

import { firstContentLine } from './first-content-line.ts';

/** Hard cap on a chat-tab title, including the truncation ellipsis. */
export const CHAT_TITLE_MAX_LENGTH = 32;

/** A sanitized title in both its capped display form and its untruncated form. */
export interface ChatTitle {
	/** Untruncated cleaned title, for tooltips and search. */
	full: string;
	/** Capped at {@link CHAT_TITLE_MAX_LENGTH} for tab display. */
	display: string;
}

/**
 * Nouns a model reaches for when prefacing its answer, e.g. "Here's the session
 * summary:". Chat titles and session summaries share one alternation because a
 * preamble is unwanted in either, whichever noun the model happened to pick.
 */
const TITLE_NOUNS = 'title|tab title|summary|session summary';

/** Strips a conversational preamble such as `Here's a summary:` or `The title is —`. */
const CONVERSATIONAL_PREFIX = new RegExp(
	`^(?:here(?:'s| is)? (?:the |a )?(?:${TITLE_NOUNS})|(?:the |a )?(?:${TITLE_NOUNS}) is)\\s*[:\\-—]?\\s*`,
	'i',
);

/**
 * Normalizes raw model output into a single title line. Strips code fences,
 * markdown emphasis, headings, list bullets, conversational prefixes (`Title:`,
 * `Here's the summary:`), surrounding quotes, and trailing sentence punctuation.
 * Shared by chat-tab naming and session-summary headings; returns the cleaned
 * line at full length, so chat callers follow with {@link truncateChatTitle}.
 * Returns null when nothing usable remains.
 * @param text - The collected agent response.
 * @returns The cleaned full-length title, or null.
 */
export function cleanTitleLine(text: string): string | null {
	if (!text) {
		return null;
	}
	const firstLine = firstContentLine(text);
	if (!firstLine) {
		return null;
	}

	const cleaned = firstLine
		.replace(/^#+\s*/, '')
		.replace(/^[-*+]\s*/, '')
		.replace(/^\d+[.)]\s*/, '')
		.replace(/^title\s*[:\-—]\s*/i, '')
		.replace(CONVERSATIONAL_PREFIX, '')
		.replace(/[*_`~]/g, '')
		.replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '')
		.replace(/[.!?,;:]+$/g, '')
		.replace(/\s+/g, ' ')
		.trim();

	return cleaned || null;
}

/**
 * Caps a cleaned title at {@link CHAT_TITLE_MAX_LENGTH}, breaking on a word
 * boundary when one falls late enough to leave a readable stem.
 * @param title - A cleaned, full-length title.
 * @returns The title capped for tab display, with a trailing ellipsis when cut.
 */
export function truncateChatTitle(title: string): string {
	if (title.length <= CHAT_TITLE_MAX_LENGTH) {
		return title;
	}
	const window = title.slice(0, CHAT_TITLE_MAX_LENGTH - 1);
	const lastSpace = window.lastIndexOf(' ');
	const truncated =
		lastSpace > CHAT_TITLE_MAX_LENGTH / 2 ? window.slice(0, lastSpace) : window;
	return `${truncated.trimEnd()}…`;
}

/**
 * Normalizes raw model output into both the capped tab title and the
 * untruncated title kept for tooltips.
 * @param text - The collected agent response.
 * @returns Both title forms, or null when nothing usable remains.
 */
export function sanitizeChatTitle(text: string): ChatTitle | null {
	const full = cleanTitleLine(text);
	return full ? { display: truncateChatTitle(full), full } : null;
}
