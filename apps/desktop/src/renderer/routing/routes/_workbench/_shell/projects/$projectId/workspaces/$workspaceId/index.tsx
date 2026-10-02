import { createFileRoute } from '@tanstack/react-router';

import { WorkspaceNoChatPage } from '@/renderer/components/workbench-shell/route-layout';
import { loadWorkspaceIndexRoute } from '@/renderer/routing/workbench-route-loaders';

/**
 * Workspace landing route shown when no chat is selected; loads workspace index
 * data for the `projectId`/`workspaceId` params and reads the `dock`/`review` search params.
 */
export const Route = createFileRoute(
	'/_workbench/_shell/projects/$projectId/workspaces/$workspaceId/',
)({
	component: WorkspaceNoChatPage,
	/** Loads the workspace index route data for the resolved params and search. */
	loader: ({ deps, params, parentMatchPromise }) =>
		loadWorkspaceIndexRoute({
			parentMatchPromise,
			params,
			search: deps,
		}),
	/** Narrows the loader dependencies to the `dock` and `review` search params. */
	loaderDeps: ({ search }) => ({
		dock: search.dock,
		review: search.review,
	}),
	staticData: {
		workbenchView: 'workspace',
	},
});
