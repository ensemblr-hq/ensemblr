import { useMemo } from 'react';
import { fuzzyScore } from '@/renderer/lib/workbench/fuzzy-score';

export type AutocompleteKind = 'mention' | 'slash' | null;

export interface AutocompleteState {
	kind: AutocompleteKind;
	query: string;
	tokenStart: number;
	tokenEnd: number;
}

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

export interface FuzzyScored<T> {
	item: T;
	score: number;
}

export function useFuzzyMatches<T>(
	items: readonly T[],
	query: string,
	getKey: (item: T) => string,
	limit = 12,
): T[] {
	return useMemo(() => {
		if (items.length === 0) {
			return [];
		}
		const scored: FuzzyScored<T>[] = [];
		for (const item of items) {
			const key = getKey(item);
			const score = fuzzyScore(key, query);
			if (score > 0) {
				scored.push({ item, score });
			}
		}
		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, limit).map((entry) => entry.item);
	}, [items, query, getKey, limit]);
}
