import { createFileRoute } from '@tanstack/react-router';

import { WorkspaceChatPage } from '@/renderer/components/workbench-shell/route-layout';
import { loadWorkspaceChatRoute } from '@/renderer/routing/workbench-route-loaders';

/**
 * Chat view for a workspace; loads the chat named by the `chatId` route param
 * (within its `projectId`/`workspaceId`) and reads the `dock`/`review` search params.
 */
export const Route = createFileRoute(
	'/_workbench/_shell/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
)({
	component: WorkspaceChatPage,
	/** Loads the workspace chat route data for the resolved params and search. */
	loader: ({ deps, location, params, parentMatchPromise }) =>
		loadWorkspaceChatRoute({
			parentMatchPromise,
			params,
			rawSearch: location.search,
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
