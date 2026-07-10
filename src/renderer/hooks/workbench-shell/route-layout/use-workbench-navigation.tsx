import { Link, useNavigate, useRouter } from '@tanstack/react-router';
import { useAtomValue, useSetAtom } from 'jotai';
import { type ReactElement, useCallback, useMemo } from 'react';

import {
	buildAddProjectMenuModel,
	findWorkspaceNavigationSelection,
	getWorkbenchStaticRoute,
} from '@/renderer/lib/workbench';
import { openLocalProjectFlow } from '@/renderer/lib/workbench/open-local-project-flow';
import {
	cloneDialogOpenAtom,
	localProjectImportDialogOpenAtom,
	quickStartDialogOpenAtom,
} from '@/renderer/state/dialogs';
import { recentProjectsAtom } from '@/renderer/state/recents';
import {
	activeChatTabByWorkspaceAtom,
	activeDockTabByWorkspaceAtom,
	activeReviewTabByWorkspaceAtom,
	getPreferredChatId,
	getPreferredDockTab,
	getPreferredReviewTab,
	lastWorkspaceSelectionAtom,
} from '@/renderer/state/workspace';
import type { NavigationContextValue } from '@/renderer/types/contexts';
import type {
	AddProjectActionId,
	AddProjectMenuModel,
	ProjectShellModel,
	WorkbenchRouteSearch,
	WorkspaceShellModel,
} from '@/renderer/types/workbench';
import type {
	WorkbenchStaticNavigationTarget,
	WorkbenchWorkspaceNavigationLinkTarget,
} from '@/renderer/types/workbench-shell';
import type { SetupDiagnosticsSnapshot } from '@/shared/ipc/contracts/setup';

/** Navigation callbacks and add-project menu wiring returned by {@link useWorkbenchNavigation}. */
export interface WorkbenchNavigationResult {
	addProjectMenu: AddProjectMenuModel;
	navigateToStaticRoute: (target: WorkbenchStaticNavigationTarget) => void;
	navigateToWorkspace: (projectId: string, workspaceId: string) => void;
	navigation: NavigationContextValue;
	onAddProject: (id: AddProjectActionId) => void;
	resolveWorkspaceRouteSearch: (
		workspace: WorkspaceShellModel,
	) => WorkbenchRouteSearch;
}

/**
 * Owns the workbench navigation callbacks (static + workspace routing), the
 * add-project menu wiring, and the local-project import flow.
 */
export function useWorkbenchNavigation({
	displayProjects,
	setupSnapshot,
}: {
	displayProjects: ProjectShellModel[];
	setupSnapshot: SetupDiagnosticsSnapshot | null;
}): WorkbenchNavigationResult {
	const navigate = useNavigate();
	const router = useRouter();
	const setLastWorkspaceSelection = useSetAtom(lastWorkspaceSelectionAtom);
	const setLocalProjectImportOpen = useSetAtom(
		localProjectImportDialogOpenAtom,
	);
	const recentProjects = useAtomValue(recentProjectsAtom);
	const reviewTabsByWorkspace = useAtomValue(activeReviewTabByWorkspaceAtom);
	const dockTabsByWorkspace = useAtomValue(activeDockTabByWorkspaceAtom);
	const chatTabsByWorkspace = useAtomValue(activeChatTabByWorkspaceAtom);
	const setCloneDialogOpen = useSetAtom(cloneDialogOpenAtom);
	const setQuickStartDialogOpen = useSetAtom(quickStartDialogOpenAtom);

	const resolveWorkspaceRouteSearch = useCallback(
		(workspace: WorkspaceShellModel): WorkbenchRouteSearch => ({
			dock: getPreferredDockTab({
				dockTabsByWorkspace,
				workspace,
			}),
			review: getPreferredReviewTab({
				reviewTabsByWorkspace,
				workspaceId: workspace.id,
			}),
		}),
		[dockTabsByWorkspace, reviewTabsByWorkspace],
	);
	const resolveWorkspaceChatId = useCallback(
		(workspace: WorkspaceShellModel) =>
			getPreferredChatId({ chatTabsByWorkspace, workspace }),
		[chatTabsByWorkspace],
	);
	const { renderStaticLink, renderWorkspaceLink } =
		useWorkbenchNavigationLinkRenderers({ resolveWorkspaceChatId });

	const navigateToStaticRoute = useCallback(
		(target: WorkbenchStaticNavigationTarget) => {
			navigate(getWorkbenchStaticRoute(target));
		},
		[navigate],
	);
	const navigateToWorkspace = useCallback(
		(nextProjectId: string, nextWorkspaceId: string) => {
			const target = findWorkspaceNavigationSelection(
				displayProjects,
				nextProjectId,
				nextWorkspaceId,
			);

			if (!target) {
				return;
			}

			navigate({
				params: {
					chatId: resolveWorkspaceChatId(target.workspace),
					projectId: target.project.id,
					workspaceId: target.workspace.id,
				},
				search: resolveWorkspaceRouteSearch(target.workspace),
				to: '/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
			});
		},
		[
			displayProjects,
			navigate,
			resolveWorkspaceChatId,
			resolveWorkspaceRouteSearch,
		],
	);

	const addProjectMenu = useMemo(
		() =>
			buildAddProjectMenuModel({
				recents: recentProjects,
				setupSnapshot,
			}),
		[recentProjects, setupSnapshot],
	);
	const onAddProject = useCallback(
		(id: AddProjectActionId) => {
			if (id === 'open-github') {
				setCloneDialogOpen(true);
				return;
			}
			if (id === 'open-local') {
				void openLocalProjectFlow({
					navigate,
					router,
					setLastWorkspaceSelection,
					setLocalProjectImportOpen,
				});
				return;
			}
			if (id === 'quick-start') {
				setQuickStartDialogOpen(true);
			}
		},
		[
			navigate,
			router,
			setCloneDialogOpen,
			setLastWorkspaceSelection,
			setLocalProjectImportOpen,
			setQuickStartDialogOpen,
		],
	);

	const navigation: NavigationContextValue = {
		renderStaticLink,
		renderWorkspaceLink,
	};

	return {
		addProjectMenu,
		navigateToStaticRoute,
		navigateToWorkspace,
		navigation,
		onAddProject,
		resolveWorkspaceRouteSearch,
	};
}

/** Builds the TanStack Router link renderers passed via the navigation context. */
function useWorkbenchNavigationLinkRenderers({
	resolveWorkspaceChatId,
}: {
	resolveWorkspaceChatId: (workspace: WorkspaceShellModel) => string;
}) {
	const renderStaticLink = useCallback(renderStaticWorkbenchNavigationLink, []);
	const renderWorkspaceLink = useCallback(
		(
			target: WorkbenchWorkspaceNavigationLinkTarget,
			children: ReactElement,
		) => (
			<Link
				params={{
					chatId: resolveWorkspaceChatId(target.workspace),
					projectId: target.workspace.projectId,
					workspaceId: target.workspace.id,
				}}
				preload='intent'
				search={target.search}
				to='/projects/$projectId/workspaces/$workspaceId/chats/$chatId'
			>
				{children}
			</Link>
		),
		[resolveWorkspaceChatId],
	);

	return {
		renderStaticLink,
		renderWorkspaceLink,
	};
}

/** Wraps static-navigation children with an intent-preload `Link`. */
function renderStaticWorkbenchNavigationLink(
	target: WorkbenchStaticNavigationTarget,
	children: ReactElement,
) {
	const spec = getWorkbenchStaticRoute(target);
	return (
		<Link params={spec.params} preload='intent' to={spec.to}>
			{children}
		</Link>
	);
}
