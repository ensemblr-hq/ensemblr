import { createFileRoute } from '@tanstack/react-router';

import { WorkspaceNoChatPage } from '@/renderer/components/workbench-shell/route-layout';
import { loadWorkspaceIndexRoute } from '@/renderer/routing/workbench-route-loaders';

export const Route = createFileRoute(
	'/_workbench/_shell/projects/$projectId/workspaces/$workspaceId/',
)({
	component: WorkspaceNoChatPage,
	loader: ({ deps, params, parentMatchPromise }) =>
		loadWorkspaceIndexRoute({
			parentMatchPromise,
			params,
			search: deps,
		}),
	loaderDeps: ({ search }) => ({
		dock: search.dock,
		review: search.review,
	}),
	staticData: {
		workbenchView: 'workspace',
	},
});
