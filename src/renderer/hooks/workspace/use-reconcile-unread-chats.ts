import { useEffect, useMemo } from 'react';

import { useUnreadChatActions } from '@/renderer/state/unread';
import type { ProjectShellModel } from '@/renderer/types/workbench';

/** Every workspace id the shell currently lists, across all projects. */
function collectWorkspaceIds(
	projects: readonly ProjectShellModel[],
): ReadonlySet<string> {
	const ids = new Set<string>();
	for (const project of projects) {
		for (const workspace of project.workspaces) {
			ids.add(workspace.id);
		}
	}
	return ids;
}

/**
 * Drops unread marks whose workspace the shell no longer lists, so archiving or
 * deleting a workspace does not strand a mark. Nothing else can clear one for a
 * workspace that is gone: the sidebar row it would light is unmounted, and the
 * jump control cannot route to it.
 *
 * An empty project list is treated as "not loaded yet" rather than "everything
 * was deleted", so a mark survives the first render before the loader resolves.
 * @param projects - The projects the shell is currently displaying
 */
export function useReconcileUnreadChats(
	projects: readonly ProjectShellModel[],
): void {
	const { retainWorkspaces } = useUnreadChatActions();
	const knownWorkspaceIds = useMemo(
		() => collectWorkspaceIds(projects),
		[projects],
	);

	useEffect(() => {
		if (knownWorkspaceIds.size === 0) {
			return;
		}
		retainWorkspaces(knownWorkspaceIds);
	}, [knownWorkspaceIds, retainWorkspaces]);
}
