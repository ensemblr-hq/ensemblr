import { useAtom } from 'jotai';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import type { ProjectShellModel } from '@/renderer/types/workbench';
import type {
	ProjectNavigationState,
	WorkspaceEntry,
} from '@/renderer/types/workbench-shell';
import {
	collapsedProjectIdsAtom,
	orderedProjectIdsAtom,
	pinnedWorkspaceIdsAtom,
} from './atoms';

/**
 * Re-orders a list of `{ id }` items to match the React element key order
 * produced by a drag-and-drop reorder.
 * @param items - Source items.
 * @param reorderedElements - React elements in their new order.
 * @returns The re-ordered items (or the original list if reconciliation fails).
 */
function getReorderedShellItems<T extends { id: string }>(
	items: T[],
	reorderedElements: ReactElement[],
): T[] {
	const itemsById = new Map(items.map((item) => [item.id, item]));
	const nextItems = reorderedElements
		.map((element) => normalizeReorderElementKey(element.key))
		.map((id) => (id ? itemsById.get(id) : undefined))
		.filter((item): item is T => Boolean(item));

	if (nextItems.length !== items.length) {
		return items;
	}

	return nextItems;
}

/** Strips React-internal key prefixes so the original id can be recovered. */
function normalizeReorderElementKey(key: ReactElement['key']) {
	if (key == null) {
		return null;
	}

	return String(key).replace(/^\.\$/, '').replace(/^\./, '');
}

/**
 * Returns items in the user-defined order, with unknown items appended.
 * @param items - Source items.
 * @param orderedIds - Persisted id order.
 * @returns Items ordered by `orderedIds` first, then any new items.
 */
function getOrderedShellItems<T extends { id: string }>(
	items: T[],
	orderedIds: string[],
): T[] {
	const itemsById = new Map(items.map((item) => [item.id, item]));
	const orderedItems = orderedIds
		.map((id) => itemsById.get(id))
		.filter((item): item is T => Boolean(item));
	const orderedIdSet = new Set(orderedIds);
	const unorderedItems = items.filter((item) => !orderedIdSet.has(item.id));

	return [...orderedItems, ...unorderedItems];
}

/**
 * Reconciles the persisted id order with the live item list, dropping stale ids
 * and appending newly-seen ones.
 * @param items - Source items.
 * @param orderedIds - Persisted id order.
 * @returns A reconciled id list.
 */
function getReconciledShellItemIds<T extends { id: string }>(
	items: T[],
	orderedIds: string[],
): string[] {
	const itemIdSet = new Set(items.map((item) => item.id));
	const orderedExistingIds = orderedIds.filter((id) => itemIdSet.has(id));
	const orderedExistingIdSet = new Set(orderedExistingIds);
	const newIds = items
		.map((item) => item.id)
		.filter((id) => !orderedExistingIdSet.has(id));

	return [...orderedExistingIds, ...newIds];
}

/**
 * React hook that exposes project sidebar state — order, collapse, pin, and
 * reorder helpers — backed by persisted Jotai atoms.
 * @param projects - Active project shell models.
 * @returns A {@link ProjectNavigationState} for the sidebar.
 */
export function useProjectNavigationState(
	projects: ProjectShellModel[],
): ProjectNavigationState {
	const projectCollapseMotionTimeoutRef = useRef<ReturnType<
		typeof setTimeout
	> | null>(null);
	const projectPinMotionTimeoutRef = useRef<ReturnType<
		typeof setTimeout
	> | null>(null);
	const [orderedProjectIds, setOrderedProjectIds] = useAtom(
		orderedProjectIdsAtom,
	);
	const [collapsedProjectIds, setCollapsedProjectIds] = useAtom(
		collapsedProjectIdsAtom,
	);
	const [pinnedWorkspaceIds, setPinnedWorkspaceIds] = useAtom(
		pinnedWorkspaceIdsAtom,
	);
	const [
		isProjectReorderPositionOnlyLayout,
		setIsProjectReorderPositionOnlyLayout,
	] = useState(false);
	const [
		isProjectReorderLayoutAnimationDisabled,
		setIsProjectReorderLayoutAnimationDisabled,
	] = useState(false);
	const collapsedProjectIdSet = new Set(collapsedProjectIds);
	const pinnedWorkspaceIdSet = new Set(pinnedWorkspaceIds);
	const orderedProjects = getOrderedShellItems(projects, orderedProjectIds);
	const workspaceEntriesById = new Map(
		orderedProjects.flatMap((project) =>
			project.workspaces.map(
				(workspace) => [workspace.id, { project, workspace }] as const,
			),
		),
	);
	const pinnedWorkspaceEntries = pinnedWorkspaceIds
		.map((workspaceId) => workspaceEntriesById.get(workspaceId))
		.filter((entry): entry is WorkspaceEntry => Boolean(entry));

	useEffect(() => {
		setOrderedProjectIds((currentProjectIds) =>
			getReconciledShellItemIds(projects, currentProjectIds),
		);
		setCollapsedProjectIds((currentProjectIds) => {
			const projectIds = new Set(projects.map((project) => project.id));
			const nextProjectIds = currentProjectIds.filter((projectId) =>
				projectIds.has(projectId),
			);

			return nextProjectIds.length === currentProjectIds.length
				? currentProjectIds
				: nextProjectIds;
		});
		setPinnedWorkspaceIds((currentWorkspaceIds) => {
			const workspaceIds = new Set(
				projects.flatMap((project) =>
					project.workspaces.map((workspace) => workspace.id),
				),
			);
			const nextWorkspaceIds = currentWorkspaceIds.filter((workspaceId) =>
				workspaceIds.has(workspaceId),
			);

			return nextWorkspaceIds.length === currentWorkspaceIds.length
				? currentWorkspaceIds
				: nextWorkspaceIds;
		});
	}, [
		projects,
		setCollapsedProjectIds,
		setOrderedProjectIds,
		setPinnedWorkspaceIds,
	]);
	useEffect(
		() => () => {
			if (projectCollapseMotionTimeoutRef.current) {
				clearTimeout(projectCollapseMotionTimeoutRef.current);
			}
			if (projectPinMotionTimeoutRef.current) {
				clearTimeout(projectPinMotionTimeoutRef.current);
			}
		},
		[],
	);

	/** Persists a new project order after a drag-and-drop reorder. */
	const reorderProjects = (reorderedElements: ReactElement[]) => {
		setOrderedProjectIds(
			getReorderedShellItems(orderedProjects, reorderedElements).map(
				(project) => project.id,
			),
		);
	};
	/** Briefly suppresses size animations during a collapse-toggle reflow. */
	const activatePositionOnlyProjectReorderLayout = () => {
		if (projectCollapseMotionTimeoutRef.current) {
			clearTimeout(projectCollapseMotionTimeoutRef.current);
		}

		setIsProjectReorderPositionOnlyLayout(true);
		projectCollapseMotionTimeoutRef.current = setTimeout(() => {
			setIsProjectReorderPositionOnlyLayout(false);
			projectCollapseMotionTimeoutRef.current = null;
		}, 180);
	};
	/** Toggles whether a project's workspace group is collapsed. */
	const toggleProjectCollapsed = (projectId: string) => {
		activatePositionOnlyProjectReorderLayout();
		setCollapsedProjectIds((currentProjectIds) =>
			currentProjectIds.includes(projectId)
				? currentProjectIds.filter(
						(currentProjectId) => currentProjectId !== projectId,
					)
				: [...currentProjectIds, projectId],
		);
	};
	/** Briefly disables layout animation during a pin-toggle reflow. */
	const disableProjectReorderLayoutAnimation = () => {
		if (projectPinMotionTimeoutRef.current) {
			clearTimeout(projectPinMotionTimeoutRef.current);
		}

		setIsProjectReorderLayoutAnimationDisabled(true);
		projectPinMotionTimeoutRef.current = setTimeout(() => {
			setIsProjectReorderLayoutAnimationDisabled(false);
			projectPinMotionTimeoutRef.current = null;
		}, 180);
	};
	/** Toggles whether a workspace is pinned to the top of the sidebar. */
	const toggleWorkspacePinned = (workspaceId: string) => {
		disableProjectReorderLayoutAnimation();
		setPinnedWorkspaceIds((currentWorkspaceIds) =>
			currentWorkspaceIds.includes(workspaceId)
				? currentWorkspaceIds.filter(
						(currentWorkspaceId) => currentWorkspaceId !== workspaceId,
					)
				: [...currentWorkspaceIds, workspaceId],
		);
	};

	return {
		collapsedProjectIdSet,
		disableProjectReorderLayoutAnimation,
		isProjectReorderLayoutAnimationDisabled,
		isProjectReorderPositionOnlyLayout,
		orderedProjects,
		pinnedWorkspaceEntries,
		pinnedWorkspaceIdSet,
		reorderProjects,
		toggleProjectCollapsed,
		toggleWorkspacePinned,
	};
}
