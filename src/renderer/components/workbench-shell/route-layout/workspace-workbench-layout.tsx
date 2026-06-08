import { getRouteApi, useChildMatches } from '@tanstack/react-router';

import { WorkbenchEmptyStateContent } from '@/renderer/components/workbench-empty-state';
import { useSetupDiagnostics } from '@/renderer/components/workbench-shell/shell-contexts';
import { useRouteProfilerMount } from '@/renderer/lib/instrumentation/route-profiler';
import {
	findWorkspaceNavigationSelection,
	getEmptyStateCopy,
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
	const { state: setupDiagnosticsState } = useSetupDiagnostics();
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
		return (
			<WorkbenchEmptyStateContent
				emptyState={getEmptyStateCopy({
					isLoading: false,
					navigationError: null,
					projectCount: model.displayProjects.length,
					setupStatus: setupDiagnosticsState.setupDiagnostics?.status,
				})}
			/>
		);
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
