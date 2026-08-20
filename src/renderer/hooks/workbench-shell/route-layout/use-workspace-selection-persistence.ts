import { useAtom } from 'jotai';
import { useEffect, useMemo } from 'react';

import {
	resolveWorkspaceNavigationRenderState,
	resolveWorkspaceNavigationSelection,
} from '@/renderer/lib/workbench';
import {
	lastWorkspaceNavigationRenderStateAtom,
	lastWorkspaceSelectionAtom,
} from '@/renderer/state/workspace';
import type { WorkbenchShellRouteState } from '@/renderer/types/components';
import type {
	ProjectShellModel,
	WorkspaceNavigationSelection,
} from '@/renderer/types/workbench';
import type { RepositoryWorkspaceNavigationSnapshot } from '@/shared/ipc/contracts/repository-navigation';

/** Current and persisted workspace selection returned by {@link useWorkspaceSelectionPersistence}. */
interface WorkspaceSelectionPersistenceResult {
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
		// Deliberately not an identity check on `projects`: this atom feeds a memo
		// that feeds this effect, so rewriting it whenever the list is merely a new
		// array — which a refetch fan-out makes it — is an unbounded render loop.
		// The held list is the *previous* snapshot by contract, so it only has to
		// be replaced when it can no longer describe the current selection.
		setLastWorkspaceNavigationRenderState((currentRenderState) =>
			currentRenderState?.selection.project.id ===
				currentSelection.project.id &&
			currentRenderState.selection.workspace.id ===
				currentSelection.workspace.id &&
			holdsSelection(currentRenderState.projects, currentSelection)
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

/**
 * True when a held project list still contains the selected workspace, which is
 * all the previous-state fallback needs of it.
 * @param projects - The project list held in the render state
 * @param selection - The selection that list has to be able to describe
 * @returns Whether the selected workspace is still present in that list
 */
function holdsSelection(
	projects: ProjectShellModel[],
	selection: WorkspaceNavigationSelection,
): boolean {
	const project = projects.find(
		(candidate) => candidate.id === selection.project.id,
	);

	return Boolean(
		project?.workspaces.some(
			(workspace) => workspace.id === selection.workspace.id,
		),
	);
}
