/**
 * Placeholder chat-tab policy: which chat tab a spawned conversation may take
 * over instead of opening one beside it.
 *
 * The renderer opens a chat tab for every workspace that has none, so that a
 * first prompt has a real row to bind to. Nobody asked for that tab, and a spawn
 * arriving afterwards should take it rather than leave the workspace showing two
 * tabs with one permanently blank. Every other open is a gesture — the strip's
 * new-tab button, a chord, a review action — and the tab it produces belongs to
 * whoever made it, draft or no draft.
 *
 * That difference cannot be inferred from the row: an unsent draft lives only in
 * renderer memory, so a tab the user opened a second ago and one the app opened
 * to fill a gap look identical. It is therefore declared at open time and
 * released the moment the tab stops being a placeholder.
 */
import type { ChatTabRow } from '../storage/repositories/chat-tab-repository.ts';

/** Metadata key marking a chat tab the app opened to fill an empty workspace. */
const PLACEHOLDER_METADATA_KEY = 'placeholder';

/**
 * True when a tab is still the placeholder the app opened on the user's behalf,
 * and so may be taken over by a spawned conversation.
 * @param tab - The open tab row to test
 * @returns True while nobody has claimed the tab
 */
export function isPlaceholderChatTab(tab: ChatTabRow): boolean {
	return tab.metadata[PLACEHOLDER_METADATA_KEY] === true;
}

/**
 * Copies metadata with the placeholder marker set, for a tab the app is opening
 * to fill an empty workspace.
 * @param metadata - Metadata the caller supplied
 * @returns A new record carrying the marker
 */
export function withPlaceholderFlag(
	metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
	return { ...metadata, [PLACEHOLDER_METADATA_KEY]: true };
}

/**
 * Copies metadata with the placeholder marker removed, for a tab somebody has
 * claimed.
 * @param metadata - The tab's stored metadata
 * @returns A new record without the marker
 */
export function withoutPlaceholderFlag(
	metadata: Record<string, unknown>,
): Record<string, unknown> {
	const { [PLACEHOLDER_METADATA_KEY]: _placeholder, ...rest } = metadata;
	return rest;
}
