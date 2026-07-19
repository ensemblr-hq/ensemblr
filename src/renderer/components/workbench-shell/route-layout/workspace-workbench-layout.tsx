import { getRouteApi, Navigate, useChildMatches } from '@tanstack/react-router';

import { useRouteProfilerMount } from '@/renderer/lib/instrumentation';
import {
	findWorkspaceNavigationSelection,
	getStringRouteParam,
} from '@/renderer/lib/workbench';

import { useWorkbenchLayoutRouteModel } from '../shell-contexts';
import { WorkspaceRouteContent } from './workspace-route-content';

const workspaceRouteApi = getRouteApi(
	'/_workbench/_shell/projects/$projectId/workspaces/$workspaceId',
);

/** Layout route for `/projects/:projectId/workspaces/:workspaceId`. */
export function WorkspaceWorkbenchLayout() {
	useRouteProfilerMount('WorkspaceWorkbenchLayout');

	const model = useWorkbenchLayoutRouteModel();
	const params = workspaceRouteApi.useParams();
	const search = workspaceRouteApi.useSearch();
	const chatId = useActiveWorkspaceChatId();
	const selection =
		findWorkspaceNavigationSelection(
			model.displayProjects,
			params.projectId,
			params.workspaceId,
		) ?? model.displaySelection;

	if (!selection) {
		// Loader (loadWorkspaceWorkbenchRoute) already redirects when the URL
		// workspace is missing at load time; this fires only when live nav data
		// drops the workspace after mount. Land on Welcome, never the old "No
		// active workspaces" screen — the index loader keeps Welcome when no
		// active workspace remains, so there is no redirect back here.
		return <Navigate replace to='/' />;
	}

	return (
		<WorkspaceRouteContent
			chatId={chatId}
			search={search}
			selection={selection}
		/>
	);
}

/** Extracts the `$chatId` URL param when the active route exposes it. */
function useActiveWorkspaceChatId() {
	const childMatches = useChildMatches({
		select: (matches): Array<Record<string, unknown>> =>
			matches.map(
				(match) => match.params as unknown as Record<string, unknown>,
			),
	});
	const chatMatch = [...childMatches]
		.reverse()
		.find((params) => getStringRouteParam(params, 'chatId'));

	return getStringRouteParam(chatMatch, 'chatId');
}
