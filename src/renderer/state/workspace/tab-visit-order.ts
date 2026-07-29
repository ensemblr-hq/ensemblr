/**
 * How many visits are remembered per workspace. Deep enough to keep back-tracking
 * useful after a long session, short enough that the map stays cheap to copy.
 */
const MAX_TRACKED_VISITS = 24;

/**
 * Promotes `tabId` to the front of a workspace's visit list, so index 0 is always
 * the tab the user is looking at and index 1 is the one visited before it.
 * Returns the input map unchanged when the tab is already in front.
 * @param visitsByWorkspace - Visit lists keyed by workspace id, most recent first
 * @param input - Visited tab id and the workspace that owns it
 * @returns A new map with the visit recorded, or the input when nothing changed
 */
export function recordTabVisit<T extends string>(
	visitsByWorkspace: Record<string, T[]>,
	{ tabId, workspaceId }: { tabId: T; workspaceId: string },
): Record<string, T[]> {
	const current = visitsByWorkspace[workspaceId] ?? [];
	if (current[0] === tabId) {
		return visitsByWorkspace;
	}

	return {
		...visitsByWorkspace,
		[workspaceId]: [
			tabId,
			...current.filter((visitedId) => visitedId !== tabId),
		].slice(0, MAX_TRACKED_VISITS),
	};
}

/**
 * Picks the most recently visited tab that is still open, which is where the
 * user should land when the tab they were on goes away. Ids that left the strip
 * are skipped, so a stale history degrades instead of pointing at a dead tab.
 *
 * The two strips ask at different moments on purpose. Session tabs resolve a
 * successor eagerly when the user closes one, because the close handler is the
 * only place that knows which tab is going. Dock tabs resolve lazily while
 * choosing what to render, because a terminal tab also disappears without any
 * close event — a crashed process or a reloaded workspace — and the lazy check
 * catches those too.
 * @param input - Visit list, the ids currently open, and an id to skip
 * @returns The tab to activate, or null when the history holds no open tab
 */
export function selectPreviouslyVisitedTab<T extends string>({
	excludeId,
	openIds,
	visitOrder,
}: {
	excludeId?: string;
	openIds: readonly T[];
	visitOrder: readonly string[];
}): T | null {
	for (const visitedId of visitOrder) {
		if (visitedId === excludeId) {
			continue;
		}
		const openId = openIds.find((candidate) => candidate === visitedId);
		if (openId) {
			return openId;
		}
	}

	return null;
}
