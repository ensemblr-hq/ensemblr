import { getDefaultStore } from 'jotai';

import { applyBoardStatus } from './board-status';
import { workspaceBoardStatusAtom } from './structure-atoms';

/**
 * Wires the agent-control board-status bridge into the renderer, both directions:
 *
 * - Inbound: applies each main → renderer board-status broadcast (an agent moved
 *   its workspace) to the global board-status atom, so the change lands even when
 *   that workspace's route is not mounted.
 * - Outbound: reports the full board-status map to the main process on startup and
 *   on every change, giving agent-control reads (`getWorkspaceStatus`,
 *   `listWorkspaces`) a source for otherwise renderer-only state.
 *
 * There is no feedback loop: an inbound broadcast updates the atom, which reports
 * the map to main, which only mirrors it (no broadcast back).
 * @returns A teardown function that removes both subscriptions.
 */
export function installAgentControlBoardStatusSync(): () => void {
	const store = getDefaultStore();
	const report = () => {
		window.ensemblr?.reportBoardStatus(store.get(workspaceBoardStatusAtom));
	};
	report();
	const unsubscribeReport = store.sub(workspaceBoardStatusAtom, report);
	const unsubscribeApply = window.ensemblr?.onAgentControlBoardStatus(
		({ workspaceId, status }) => {
			store.set(workspaceBoardStatusAtom, (statusByWorkspaceId) =>
				applyBoardStatus(statusByWorkspaceId, workspaceId, status),
			);
		},
	);
	return () => {
		unsubscribeReport();
		unsubscribeApply?.();
	};
}
