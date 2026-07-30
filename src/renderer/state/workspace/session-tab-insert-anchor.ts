import type { SessionTabModel } from '@/renderer/types/workbench';

/**
 * Anchor a tab opened from inside a conversation (file, diff, comment, terminal)
 * is placed to the right of, so it lands beside its origin rather than at the far
 * end of the strip. Only a real open row can anchor: the synthetic
 * `<workspaceId>:overview` placeholder that backs an empty strip holds no strip
 * position, so those opens append instead.
 * @param sessionTabs - The workspace's open strip tabs
 * @param activeSessionId - Id of the tab the user is currently on
 * @returns The anchor tab id, or null when the new tab should append
 */
export function resolveInsertAnchorId(
	sessionTabs: readonly SessionTabModel[],
	activeSessionId: string,
): string | null {
	return sessionTabs.some((session) => session.id === activeSessionId)
		? activeSessionId
		: null;
}
