import { createFileRoute } from '@tanstack/react-router';

import { WorkbenchPlaceholderPage } from '@/renderer/components/workbench-shell/route-layout';

export const Route = createFileRoute('/_workbench/_shell/help')({
	component: HelpRoute,
	staticData: {
		workbenchView: 'help',
	},
});

/** Help workbench view (placeholder pending content). */
function HelpRoute() {
	return <WorkbenchPlaceholderPage view='help' />;
}
