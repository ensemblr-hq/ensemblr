import { useStore } from 'jotai';
import { useCallback, useSyncExternalStore } from 'react';

import {
	type AgentWorkspaceLiveState,
	agentWorkspaceLiveStateAtomFamily,
} from './atoms';

/**
 * Reads one workspace's live agent state and follows it. It goes through a store
 * subscription rather than `useAtomValue`, which subscribes after the render that
 * read the atom and never looks again: a seed the feed writes in the same commit
 * as this reader's first mount would go unseen. The external-store hook checks
 * its snapshot once it has subscribed, whatever order the two mount in.
 * @param workspaceId - Workspace whose sessions' live state to read
 * @returns The live state of every session in the workspace, keyed by session id
 */
export function useAgentWorkspaceLiveState(
	workspaceId: string,
): AgentWorkspaceLiveState {
	const store = useStore();
	const liveStateAtom = agentWorkspaceLiveStateAtomFamily(workspaceId);
	const subscribe = useCallback(
		(onChange: () => void) => store.sub(liveStateAtom, onChange),
		[store, liveStateAtom],
	);
	const getSnapshot = useCallback(
		() => store.get(liveStateAtom),
		[store, liveStateAtom],
	);
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
