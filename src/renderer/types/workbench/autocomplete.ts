/** Kind of composer autocomplete token under the caret, or `null` when none. */
export type AutocompleteKind = 'mention' | 'slash' | null;

/** Detected autocomplete token: its kind, query, and span within the composer text. */
export interface AutocompleteState {
	kind: AutocompleteKind;
	query: string;
	tokenStart: number;
	tokenEnd: number;
}
