import { Outlet, useChildMatches } from '@tanstack/react-router';
import { useAtom } from 'jotai';
import { useMemo } from 'react';
import { ConciergeLauncher } from '@/renderer/components/concierge';
import { CloneGithubDialog } from '@/renderer/components/welcome/clone-github-dialog';
import { LocalProjectImportDialog } from '@/renderer/components/welcome/local-project-import-dialog';
import { QuickStartDialog } from '@/renderer/components/welcome/quick-start-dialog';
import { WorkbenchFrame } from '@/renderer/components/workbench-shell/frame';
import {
	NavigationProvider,
	SetupDiagnosticsProvider,
} from '@/renderer/components/workbench-shell/shell-contexts';
import { WorkspaceLifecycleDialogHost } from '@/renderer/components/workbench-shell/workspace-lifecycle-dialog-host';
import {
	useWorkbenchLayoutModel,
	workbenchRouteApi,
} from '@/renderer/hooks/workbench-shell/route-layout/use-workbench-layout-model';
import { useAutoMarkUnread } from '@/renderer/hooks/workspace/use-auto-mark-unread';
import { useReconcileUnreadChats } from '@/renderer/hooks/workspace/use-reconcile-unread-chats';
import { useReconcileWorkspaceState } from '@/renderer/hooks/workspace/use-reconcile-workspace-state';
import { useRouteProfilerMount } from '@/renderer/lib/instrumentation';
import {
	packWorkbenchShellRouteState,
	unpackWorkbenchShellRouteState,
} from '@/renderer/lib/workbench';
import {
	cloneDialogOpenAtom,
	localProjectImportDialogOpenAtom,
	quickStartDialogOpenAtom,
} from '@/renderer/state/dialogs';
import type { WorkbenchShellRouteState } from '@/renderer/types/components';
import { WorkbenchLayoutModelProvider } from '../shell-contexts';
import { AgentControlWorkspaceFocusBridge } from './agent-control-workspace-focus-bridge';
import { NotificationFocusBridge } from './notification-focus-bridge';

/** Workbench shell layout — builds the layout model and renders the navigation frame. */
export function WorkbenchShellLayout() {
	useRouteProfilerMount('WorkbenchShellLayout');

	const loaderData = workbenchRouteApi.useLoaderData();
	const routeState = useWorkbenchShellRouteState();
	// ⌘/Ctrl+W for non-workspace shell views (welcome, project, etc.) needs no
	// handler here: `tab.close` is reported as always available, so the item
	// stays enabled and `useMenuCommandBridge` falls back to closing the window.
	// The workspace view registers its own action in `WorkspaceRouteContent`.
	const { model, navigation, setupDiagnostics } = useWorkbenchLayoutModel({
		loaderData,
		routeState,
	});
	useAutoMarkUnread(model.activeWorkspace?.id ?? null);
	useReconcileUnreadChats(model.displayProjects);
	useReconcileWorkspaceState();
	const [cloneOpen, setCloneOpen] = useAtom(cloneDialogOpenAtom);
	const [localProjectImportOpen] = useAtom(localProjectImportDialogOpenAtom);
	const [quickStartOpen, setQuickStartOpen] = useAtom(quickStartDialogOpenAtom);

	return (
		<NavigationProvider value={navigation}>
			<SetupDiagnosticsProvider value={setupDiagnostics}>
				<WorkbenchFrame
					activeProject={model.activeProject}
					activeView={routeState.view}
					activeWorkspace={model.activeWorkspace}
					addProjectMenu={model.addProjectMenu}
					health={model.health}
					onAddProject={model.onAddProject}
					onStaticNavigationSelect={model.navigateToStaticRoute}
					onWorkspaceSelect={model.navigateToWorkspace}
					projects={model.displayProjects}
					resolveWorkspaceRouteSearch={model.resolveWorkspaceRouteSearch}
				>
					<WorkbenchLayoutModelProvider value={model}>
						<AgentControlWorkspaceFocusBridge />
						<NotificationFocusBridge />
						<Outlet />
						{/* Inside the frame so the maximized panel — which covers the
						    sidebar's own expand trigger — can offer one of its own, and
						    inside the layout model so a file the Concierge names can be
						    opened in the workspace that holds it. */}
						<ConciergeLauncher />
					</WorkbenchLayoutModelProvider>
				</WorkbenchFrame>
				<CloneGithubDialog onOpenChange={setCloneOpen} open={cloneOpen} />
				<LocalProjectImportDialog open={localProjectImportOpen} />
				<QuickStartDialog
					onOpenChange={setQuickStartOpen}
					open={quickStartOpen}
				/>
				<WorkspaceLifecycleDialogHost
					activeWorkspaceId={model.activeWorkspace?.id ?? null}
				/>
			</SetupDiagnosticsProvider>
		</NavigationProvider>
	);
}

/**
 * Derives the active workbench view + URL params from the current router match.
 *
 * The selector packs its answer into one string and this unpacks it, which is a
 * render-count constraint rather than a style choice — see
 * {@link packWorkbenchShellRouteState}. Selecting the matches themselves handed
 * back a fresh array on every router-state notification, so the shell, its
 * frame, its sidebar and every workspace row re-rendered for router activity
 * that changed nothing, which is what made a burst of workspace switches during
 * an archive read as the chrome coming apart.
 * @returns The active view plus the routed project and workspace ids
 */
function useWorkbenchShellRouteState(): WorkbenchShellRouteState {
	const packedRouteState = useChildMatches({
		select: (matches) =>
			packWorkbenchShellRouteState(
				matches.map((match) => ({
					params: match.params as unknown as Record<string, unknown>,
					staticData: match.staticData,
				})),
			),
	});

	return useMemo(
		() => unpackWorkbenchShellRouteState(packedRouteState),
		[packedRouteState],
	);
}
