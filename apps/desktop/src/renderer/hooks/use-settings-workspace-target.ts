import { useAtomValue } from 'jotai';
import { useState } from 'react';

import { workbenchRouteApi } from '@/renderer/hooks/workbench-shell/route-layout/use-workbench-layout-model';
import { lastWorkspaceSelectionAtom } from '@/renderer/state/workspace';
import type { WorkspaceShellModel } from '@/renderer/types/workbench';

/**
 * Picks the workspace a target picker opens on: the last-opened workspace when
 * it belongs to this repository, else the repository's first live workspace.
 * @param workspaces - Live workspaces of the repository.
 * @param repoId - Repository the workspaces belong to.
 * @param lastSelection - The last-selected (project, workspace) pair.
 * @returns The workspace id to seed with, or undefined when the repo has none.
 */
function resolveInitialWorkspaceId(
	workspaces: WorkspaceShellModel[],
	repoId: string,
	lastSelection: { projectId: string; workspaceId: string } | null,
): string | undefined {
	const remembered =
		lastSelection?.projectId === repoId
			? workspaces.find(
					(candidate) => candidate.id === lastSelection.workspaceId,
				)
			: undefined;

	return remembered?.id ?? workspaces[0]?.id;
}

/**
 * Owns the "which live workspace does this settings screen write to" choice
 * that every screen editing committed repository config now has to make, since
 * shared config is no longer written to the root clone. The seed is remembered
 * rather than asked for, so the common case needs no interaction; the returned
 * setter backs the screen's picker.
 *
 * The selection is component state on purpose — it is scoped to one open
 * settings screen and must not outlive it or leak into another repository's. A
 * pick whose workspace is archived while the screen is open falls back to the
 * seed rather than naming a workspace the picker can no longer show.
 *
 * @param repoId - Repository whose workspaces are the candidates.
 * @returns The repository's live workspaces, the picked id, and the picker's setter.
 */
export function useSettingsWorkspaceTarget(repoId: string): {
	selectWorkspace: (workspaceId: string) => void;
	selectedWorkspaceId: string | undefined;
	workspaces: WorkspaceShellModel[];
} {
	const loaderData = workbenchRouteApi.useLoaderData();
	const workspaces =
		loaderData.projects.find((project) => project.id === repoId)?.workspaces ??
		[];
	const lastSelection = useAtomValue(lastWorkspaceSelectionAtom);
	const [pickedWorkspaceId, setPickedWorkspaceId] = useState(() =>
		resolveInitialWorkspaceId(workspaces, repoId, lastSelection),
	);
	const stillLive = workspaces.some(
		(candidate) => candidate.id === pickedWorkspaceId,
	);

	return {
		selectWorkspace: setPickedWorkspaceId,
		selectedWorkspaceId: stillLive
			? pickedWorkspaceId
			: resolveInitialWorkspaceId(workspaces, repoId, lastSelection),
		workspaces,
	};
}
