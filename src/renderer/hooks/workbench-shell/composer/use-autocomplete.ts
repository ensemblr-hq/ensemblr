import type { AutocompleteState } from '@/renderer/types/workbench';

const SLASH_RE = /(?:^|\s)\/([\w:-]*)$/;
const MENTION_RE = /(?:^|\s)@([\w\-/.]*)$/;

/**
 * Detects whether the textarea caret currently sits inside an @-mention or
 * /-command token. Returns the kind, query, and the token's start/end indices
 * so callers can replace just that span. Slash commands allow `:` for Pi skill
 * commands such as `/skill:caveman`.
 */
export function detectAutocomplete(
	value: string,
	caret: number,
): AutocompleteState {
	const before = value.slice(0, caret);

	const slashMatch = before.match(SLASH_RE);
	if (slashMatch) {
		const matchText = slashMatch[0];
		const slashIndex =
			before.length - matchText.length + matchText.indexOf('/');
		const query = slashMatch[1] ?? '';
		return {
			kind: 'slash',
			query,
			tokenStart: slashIndex,
			tokenEnd: caret,
		};
	}

	const mentionMatch = before.match(MENTION_RE);
	if (mentionMatch) {
		const matchText = mentionMatch[0];
		const atIndex = before.length - matchText.length + matchText.indexOf('@');
		const query = mentionMatch[1] ?? '';
		return {
			kind: 'mention',
			query,
			tokenStart: atIndex,
			tokenEnd: caret,
		};
	}

	return { kind: null, query: '', tokenStart: caret, tokenEnd: caret };
}
