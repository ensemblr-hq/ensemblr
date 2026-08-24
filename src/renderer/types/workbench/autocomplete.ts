/**
 * Kind of composer autocomplete token under the caret, or `null` when none.
 *
 * `mention` and `entity` are the same `@` token read by two different composers:
 * a workspace composer ranks it against that workspace's files, the Concierge
 * against every project, workspace, and chat in the app. They are separate kinds
 * rather than one because the menu renders a different row for each, and a
 * surface that offered both would be offering to attach a file it has no
 * workspace to read.
 */
export type AutocompleteKind = 'entity' | 'mention' | 'slash' | null;

/** Detected autocomplete token: its kind, query, and span within the composer text. */
export interface AutocompleteState {
	kind: AutocompleteKind;
	query: string;
	tokenStart: number;
	tokenEnd: number;
}
