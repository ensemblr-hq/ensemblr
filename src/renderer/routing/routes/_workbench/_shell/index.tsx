import { createFileRoute } from '@tanstack/react-router';

import { Welcome } from '@/renderer/components/welcome';

/** Index route for the workbench shell; renders the Welcome view when no project is selected. */
export const Route = createFileRoute('/_workbench/_shell/')({
	component: WelcomeRoute,
	staticData: {
		workbenchView: 'welcome',
	},
});

/** Welcome view shown when no project is selected. */
function WelcomeRoute() {
	return <Welcome />;
}
