import { useAtom } from 'jotai';
import { useEffect, useMemo } from 'react';

import {
	resolveWorkspaceNavigationRenderState,
	resolveWorkspaceNavigationSelection,
	type WorkspaceNavigationSelection,
} from '@/renderer/lib/workbench';
import {
	lastWorkspaceNavigationRenderStateAtom,
	lastWorkspaceSelectionAtom,
} from '@/renderer/state/workspace';
import type { WorkbenchShellRouteState } from '@/renderer/types/components';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import type { RepositoryWorkspaceNavigationSnapshot } from '@/shared/ipc/contracts/repository-navigation';

export interface WorkspaceSelectionPersistenceResult {
	currentSelection: WorkspaceNavigationSelection | null;
	displayProjects: ProjectShellModel[];
	displaySelection: WorkspaceNavigationSelection | null;
}

/**
 * Owns the two workspace-selection persistence atoms, derives the current
 * selection and navigation render state from route/projects, and persists the
 * latest selection back to the atoms whenever it changes.
 */
export function useWorkspaceSelectionPersistence({
	hasPreloadBridge,
	isRepositoryWorkspaceNavigationFetching,
	isRepositoryWorkspaceNavigationLoading,
	isRepositoryWorkspaceNavigationPlaceholderData,
	navigationSnapshot,
	projects,
	routeState,
}: {
	hasPreloadBridge: boolean;
	isRepositoryWorkspaceNavigationFetching: boolean;
	isRepositoryWorkspaceNavigationLoading: boolean;
	isRepositoryWorkspaceNavigationPlaceholderData: boolean;
	navigationSnapshot: RepositoryWorkspaceNavigationSnapshot | null;
	projects: ProjectShellModel[];
	routeState: WorkbenchShellRouteState;
}): WorkspaceSelectionPersistenceResult {
	const [lastWorkspaceSelection, setLastWorkspaceSelection] = useAtom(
		lastWorkspaceSelectionAtom,
	);
	const [
		lastWorkspaceNavigationRenderState,
		setLastWorkspaceNavigationRenderState,
	] = useAtom(lastWorkspaceNavigationRenderStateAtom);

	const currentSelection = useMemo(
		() =>
			resolveWorkspaceNavigationSelection({
				projects,
				routeProjectId: routeState.routeProjectId,
				routeWorkspaceId: routeState.routeWorkspaceId,
				storedSelection:
					routeState.routeProjectId && routeState.routeWorkspaceId
						? undefined
						: lastWorkspaceSelection,
			}),
		[
			projects,
			routeState.routeProjectId,
			routeState.routeWorkspaceId,
			lastWorkspaceSelection,
		],
	);
	const navigationRenderState = useMemo(
		() =>
			resolveWorkspaceNavigationRenderState({
				canUsePreviousState:
					hasPreloadBridge &&
					!currentSelection &&
					(isRepositoryWorkspaceNavigationLoading ||
						isRepositoryWorkspaceNavigationFetching ||
						isRepositoryWorkspaceNavigationPlaceholderData ||
						!navigationSnapshot),
				previousState: lastWorkspaceNavigationRenderState,
				projects,
				routeProjectId: routeState.routeProjectId,
				routeWorkspaceId: routeState.routeWorkspaceId,
				selection: currentSelection,
			}),
		[
			currentSelection,
			hasPreloadBridge,
			lastWorkspaceNavigationRenderState,
			navigationSnapshot,
			projects,
			isRepositoryWorkspaceNavigationFetching,
			isRepositoryWorkspaceNavigationLoading,
			isRepositoryWorkspaceNavigationPlaceholderData,
			routeState.routeProjectId,
			routeState.routeWorkspaceId,
		],
	);
	const displayProjects = navigationRenderState?.projects ?? projects;
	const displaySelection = navigationRenderState?.selection ?? null;

	useEffect(() => {
		if (!currentSelection) {
			return;
		}

		const nextSelection = {
			projectId: currentSelection.project.id,
			workspaceId: currentSelection.workspace.id,
		};

		setLastWorkspaceSelection((currentSelection) =>
			currentSelection?.projectId === nextSelection.projectId &&
			currentSelection.workspaceId === nextSelection.workspaceId
				? currentSelection
				: nextSelection,
		);
		setLastWorkspaceNavigationRenderState((currentRenderState) =>
			currentRenderState?.selection.project.id ===
				currentSelection.project.id &&
			currentRenderState.selection.workspace.id ===
				currentSelection.workspace.id &&
			currentRenderState.projects === projects
				? currentRenderState
				: {
						projects,
						selection: currentSelection,
						source: 'current',
					},
		);
	}, [
		currentSelection,
		projects,
		setLastWorkspaceNavigationRenderState,
		setLastWorkspaceSelection,
	]);

	return {
		currentSelection,
		displayProjects,
		displaySelection,
	};
}
