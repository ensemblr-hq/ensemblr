import { useSetAtom } from 'jotai';
import { useEffect } from 'react';
import type { DockTabModel } from '@/renderer/types/workbench';
import {
	type WorkspaceDockActivityState,
	workspaceDockActivityByWorkspaceAtom,
} from './layout-atoms';

/**
 * Reports whether any dock tab is currently running.
 * @param dockTabs - Dock tabs to inspect
 * @returns True when at least one tab has a `running` status
 */
function hasRunningDockTab(dockTabs: readonly DockTabModel[]): boolean {
	return dockTabs.some((tab) => tab.status === 'running');
}

/**
 * Classifies the currently running dock activity for sidebar badge color.
 * @param dockTabs - Dock tabs to inspect
 * @returns Setup-running activity first, generic running activity next, or null
 */
export function getRunningDockActivityState(
	dockTabs: readonly DockTabModel[],
): WorkspaceDockActivityState | null {
	if (
		dockTabs.some(
			(tab) => tab.kind === 'setup-script' && tab.status === 'running',
		)
	) {
		return 'setup-running';
	}

	return hasRunningDockTab(dockTabs) ? 'running' : null;
}

/**
 * Publishes the active workspace's live dock activity into the shared atom so its
 * sidebar row reflects running terminals sooner than the next navigation poll.
 *
 * Only the active `WorkspaceRouteContent` mounts, so the atom holds at most this
 * one workspace's entry; inactive rows keep their navigation snapshot instead.
 * @param dockTabs - Live dock tabs for the active workspace
 * @param workspaceId - Id of the active workspace being published
 */
export function usePublishWorkspaceDockActivity({
	dockTabs,
	workspaceId,
}: {
	dockTabs: readonly DockTabModel[];
	workspaceId: string;
}) {
	const setWorkspaceDockActivity = useSetAtom(
		workspaceDockActivityByWorkspaceAtom,
	);
	const dockActivityState = getRunningDockActivityState(dockTabs);

	useEffect(() => {
		setWorkspaceDockActivity((previous) => {
			if (previous[workspaceId] === dockActivityState) {
				return previous;
			}
			const next = { ...previous };
			if (dockActivityState) {
				next[workspaceId] = dockActivityState;
			} else {
				delete next[workspaceId];
			}
			return next;
		});

		return () => {
			setWorkspaceDockActivity((previous) => {
				if (!previous[workspaceId]) {
					return previous;
				}
				const next = { ...previous };
				delete next[workspaceId];
				return next;
			});
		};
	}, [dockActivityState, setWorkspaceDockActivity, workspaceId]);
}
