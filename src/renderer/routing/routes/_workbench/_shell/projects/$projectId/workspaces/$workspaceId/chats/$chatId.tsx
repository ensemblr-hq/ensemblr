import { createFileRoute } from '@tanstack/react-router';

import { WorkspaceChatPage } from '@/renderer/components/workbench-shell/route-layout';
import { loadWorkspaceChatRoute } from '@/renderer/routing/workbench-route-loaders';

export const Route = createFileRoute(
	'/_workbench/_shell/projects/$projectId/workspaces/$workspaceId/chats/$chatId',
)({
	component: WorkspaceChatPage,
	loader: ({ deps, location, params, parentMatchPromise }) =>
		loadWorkspaceChatRoute({
			parentMatchPromise,
			params,
			rawSearch: location.search,
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
