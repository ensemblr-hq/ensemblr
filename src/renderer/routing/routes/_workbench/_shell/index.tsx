import { createFileRoute } from '@tanstack/react-router';

import { WorkbenchPlaceholderPage } from '@/renderer/components/workbench-shell/route-layout';

export const Route = createFileRoute('/_workbench/_shell/')({
	component: DashboardRoute,
	staticData: {
		workbenchView: 'dashboard',
	},
});

/** Dashboard workbench view (placeholder pending content). */
function DashboardRoute() {
	return <WorkbenchPlaceholderPage view='dashboard' />;
}
