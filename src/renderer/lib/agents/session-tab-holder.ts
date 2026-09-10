import type { ChatTabWire } from '@/shared/ipc/contracts/chat-tab';

/**
 * Maps each session to its open tab, or its newest archived tab when none is open.
 * @param openTabs - Live tab holders in stable display order.
 * @param closedTabs - Archived tab holders in any order.
 * @returns The preferred chat-tab id for each attached agent session.
 */
export function sessionTabHolderIds({
	closedTabs,
	openTabs,
}: {
	closedTabs: readonly ChatTabWire[];
	openTabs: readonly ChatTabWire[];
}): ReadonlyMap<string, string> {
	const holders = new Map<string, ChatTabWire>();
	for (const tab of closedTabs) {
		if (!tab.agentSessionId) {
			continue;
		}
		const held = holders.get(tab.agentSessionId);
		const closedAt = tab.closedAt ?? '';
		const heldClosedAt = held?.closedAt ?? '';
		if (
			!held ||
			closedAt > heldClosedAt ||
			(closedAt === heldClosedAt && tab.id > held.id)
		) {
			holders.set(tab.agentSessionId, tab);
		}
	}
	for (const tab of openTabs) {
		if (
			tab.agentSessionId &&
			holders.get(tab.agentSessionId)?.closedAt !== null
		) {
			holders.set(tab.agentSessionId, tab);
		}
	}
	return new Map(
		[...holders].map(([sessionId, tab]) => [sessionId, tab.id] as const),
	);
}
