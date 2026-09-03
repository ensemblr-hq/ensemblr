/**
 * Deliberately **not** re-exported from `lib/workbench/index.ts`. Its callers
 * span the composer, the Concierge's reference catalogue, and the tab-model
 * mappers, and routing a one-line predicate through the barrel would drag that
 * barrel's `api/ensemblr-queries` chain into each of them — the same trap
 * `board-issues` records. Import it by path.
 */

import type { ChatTabWire } from '@/shared/ipc/contracts/chat-tab';

/**
 * Whether a chat tab hosts a spawned sub-agent.
 *
 * The marker is written onto the tab rather than inferred from lineage, so it
 * outlives the child's session — a finished delegate's tab, and the transcript
 * it left behind, still read as a sub-agent's. One reader for it here keeps the
 * tab strip, the transcript chips, and the Concierge's `@` menu agreeing.
 * @param tab - The chat tab in wire form.
 * @returns True when the tab carries the sub-agent marker.
 */
export function isSubAgentTab(tab: ChatTabWire): boolean {
	return tab.metadata.agentRole === 'subagent';
}
