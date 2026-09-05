/**
 * Ephemeral preview-tab policy, mirroring an editor's single reusable preview
 * slot: a tab opened as a preview is retargeted by the next preview open until
 * the user pins it, so browsing files and diffs never grows the strip.
 */
import type {
	ChatTabKind,
	ChatTabRow,
} from '../storage/repositories/chat-tab-repository.ts';

/** Metadata key marking a tab as the workspace's ephemeral preview slot. */
const PREVIEW_METADATA_KEY = 'preview';

/**
 * Tab kinds that may occupy the preview slot. Chat and terminal tabs own an
 * agent session or a live PTY, so replacing one would discard work the user
 * cannot get back.
 */
const PREVIEWABLE_KINDS: ReadonlySet<ChatTabKind> = new Set([
	'diagram',
	'diff',
	'document',
	'file',
	'preview',
]);

/**
 * True when a tab of this kind may be opened as an ephemeral preview.
 * @param kind - Kind the caller is opening
 * @returns True for read-only subject tabs, false for chat and terminal tabs
 */
export function canPreviewKind(kind: ChatTabKind): boolean {
	return PREVIEWABLE_KINDS.has(kind);
}

/**
 * True when a tab currently holds the workspace's ephemeral preview slot.
 * @param tab - The open tab row to test
 * @returns True while the tab is still ephemeral
 */
export function isPreviewTab(tab: ChatTabRow): boolean {
	return tab.metadata[PREVIEW_METADATA_KEY] === true;
}

/**
 * Copies metadata with the preview marker set, for a tab entering the slot.
 * @param metadata - Subject metadata the caller supplied
 * @returns A new record carrying the marker
 */
export function withPreviewFlag(
	metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
	return { ...metadata, [PREVIEW_METADATA_KEY]: true };
}

/**
 * Copies metadata with the preview marker removed, for a tab being pinned.
 * @param metadata - The tab's stored metadata
 * @returns A new record without the marker
 */
export function withoutPreviewFlag(
	metadata: Record<string, unknown>,
): Record<string, unknown> {
	const { [PREVIEW_METADATA_KEY]: _preview, ...rest } = metadata;
	return rest;
}

/**
 * Finds the workspace's ephemeral preview tab, which the next preview open
 * retargets rather than adding a second one.
 * @param openTabs - The workspace's open tabs, in strip order
 * @returns The preview tab, or undefined when every open tab is permanent
 */
export function findPreviewSlot(
	openTabs: readonly ChatTabRow[],
): ChatTabRow | undefined {
	return openTabs.find(isPreviewTab);
}
