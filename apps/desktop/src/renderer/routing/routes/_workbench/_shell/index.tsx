import { createFileRoute } from '@tanstack/react-router';

import { Welcome } from '@/renderer/components/welcome';
import { loadWorkbenchIndexRoute } from '@/renderer/routing/workbench-route-loaders';

/** Index route for the workbench shell; redirects to the last workspace when one is available. */
export const Route = createFileRoute('/_workbench/_shell/')({
	component: WelcomeRoute,
	/** Opens the last-used workspace before rendering Welcome. */
	loader: ({ context, parentMatchPromise }) =>
		loadWorkbenchIndexRoute({
			parentMatchPromise,
			queryClient: context.queryClient,
		}),
	staticData: {
		workbenchView: 'welcome',
	},
});

/** Welcome view shown when no project is selected. */
function WelcomeRoute() {
	return <Welcome />;
}
