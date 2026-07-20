/**
 * Pure helpers for normalizing an LLM-generated chat-tab title. Kept free of the
 * pi/sqlite runtime so the full sanitization contract unit-tests under Vitest.
 */

import { firstContentLine } from './first-content-line.ts';

/** Hard cap on a chat-tab title, including the truncation ellipsis. */
export const CHAT_TITLE_MAX_LENGTH = 32;

/**
 * Normalizes raw model output into a single short title line. Strips code
 * fences, markdown emphasis, headings, list bullets, conversational prefixes
 * (`Title:`, `Here's the title:`), surrounding quotes, and trailing sentence
 * punctuation, then caps the length at a word boundary. Returns null when
 * nothing usable remains.
 * @param text - The collected agent response.
 * @returns A clean title, or null.
 */
export function sanitizeChatTitle(text: string): string | null {
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
		.replace(
			/^(?:here(?:'s| is)? (?:the |a )?(?:title|tab title)|(?:the |a )?(?:title|tab title) is)\s*[:\-—]?\s*/i,
			'',
		)
		.replace(/[*_`~]/g, '')
		.replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '')
		.replace(/[.!?,;:]+$/g, '')
		.replace(/\s+/g, ' ')
		.trim();

	if (!cleaned) {
		return null;
	}
	if (cleaned.length <= CHAT_TITLE_MAX_LENGTH) {
		return cleaned;
	}
	const window = cleaned.slice(0, CHAT_TITLE_MAX_LENGTH - 1);
	const lastSpace = window.lastIndexOf(' ');
	const truncated =
		lastSpace > CHAT_TITLE_MAX_LENGTH / 2 ? window.slice(0, lastSpace) : window;
	return `${truncated.trimEnd()}…`;
}
