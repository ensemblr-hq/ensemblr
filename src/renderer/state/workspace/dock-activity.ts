import { useSetAtom } from 'jotai';
import { useEffect } from 'react';
import type { DockTabModel } from '@/renderer/types/workbench';
import { workspaceDockActivityByWorkspaceAtom } from './layout-atoms';

/**
 * Reports whether any dock tab is currently running.
 * @param dockTabs - Dock tabs to inspect
 * @returns True when at least one tab has a `running` status
 */
export function hasRunningDockTab(dockTabs: readonly DockTabModel[]): boolean {
	return dockTabs.some((tab) => tab.status === 'running');
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
	const hasRunningDockActivity = hasRunningDockTab(dockTabs);

	useEffect(() => {
		setWorkspaceDockActivity((previous) => {
			const current = previous[workspaceId] === true;
			if (current === hasRunningDockActivity) {
				return previous;
			}
			const next = { ...previous };
			if (hasRunningDockActivity) {
				next[workspaceId] = true;
			} else {
				delete next[workspaceId];
			}
			return next;
		});

		return () => {
			setWorkspaceDockActivity((previous) => {
				if (previous[workspaceId] !== true) {
					return previous;
				}
				const next = { ...previous };
				delete next[workspaceId];
				return next;
			});
		};
	}, [hasRunningDockActivity, setWorkspaceDockActivity, workspaceId]);
}
