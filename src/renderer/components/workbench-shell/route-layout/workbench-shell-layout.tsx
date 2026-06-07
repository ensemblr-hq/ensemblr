import { Outlet, useChildMatches } from '@tanstack/react-router';
import {
	NavigationProvider,
	SetupDiagnosticsProvider,
} from '@/renderer/components/workbench-shell/contexts';
import { WorkbenchFrame } from '@/renderer/components/workbench-shell/frame';
import { useRouteProfilerMount } from '@/renderer/lib/instrumentation/route-profiler';
import {
	getStringRouteParam,
	getWorkbenchStaticView,
	isWorkbenchActiveView,
} from '@/renderer/lib/workbench';
import type {
	WorkbenchChildMatch,
	WorkbenchShellRouteState,
} from '@/renderer/types/components';

import { WorkbenchLayoutModelProvider } from './layout-model-context';
import {
	useWorkbenchLayoutModel,
	workbenchRouteApi,
} from './use-workbench-layout-model';

/** Workbench shell layout — builds the layout model and renders the navigation frame. */
export function WorkbenchShellLayout() {
	useRouteProfilerMount('WorkbenchShellLayout');

	const loaderData = workbenchRouteApi.useLoaderData();
	const routeState = useWorkbenchShellRouteState();
	const { model, navigation, setupDiagnostics } = useWorkbenchLayoutModel({
		loaderData,
		routeState,
	});

	return (
		<NavigationProvider value={navigation}>
			<SetupDiagnosticsProvider value={setupDiagnostics}>
				<WorkbenchFrame
					activeProject={model.activeProject}
					activeView={routeState.view}
					activeWorkspace={model.activeWorkspace}
					addProjectMenu={model.addProjectMenu}
					health={model.health}
					onStaticNavigationSelect={model.navigateToStaticRoute}
					onWorkspaceSelect={model.navigateToWorkspace}
					projects={model.displayProjects}
					resolveWorkspaceRouteSearch={model.resolveWorkspaceRouteSearch}
				>
					<WorkbenchLayoutModelProvider value={model}>
						<Outlet />
					</WorkbenchLayoutModelProvider>
				</WorkbenchFrame>
			</SetupDiagnosticsProvider>
		</NavigationProvider>
	);
}

/** Derives the active workbench view + URL params from the current router match. */
function useWorkbenchShellRouteState(): WorkbenchShellRouteState {
	const childMatches = useChildMatches({
		select: (matches): WorkbenchChildMatch[] =>
			matches.map((match) => ({
				params: match.params as unknown as Record<string, unknown>,
				view: getWorkbenchStaticView(match.staticData),
			})),
	});
	const viewMatch = [...childMatches]
		.reverse()
		.find((match) => isWorkbenchActiveView(match.view));
	const view = isWorkbenchActiveView(viewMatch?.view)
		? viewMatch.view
		: 'welcome';

	if (view !== 'workspace') {
		return { view };
	}

	const workspaceMatch = [...childMatches]
		.reverse()
		.find(
			(match) =>
				getStringRouteParam(match.params, 'projectId') &&
				getStringRouteParam(match.params, 'workspaceId'),
		);

	return {
		routeProjectId: getStringRouteParam(workspaceMatch?.params, 'projectId'),
		routeWorkspaceId: getStringRouteParam(
			workspaceMatch?.params,
			'workspaceId',
		),
		view,
	};
}
