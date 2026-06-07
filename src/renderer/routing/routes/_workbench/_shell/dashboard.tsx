import { createFileRoute } from '@tanstack/react-router';

import { WorkbenchPlaceholderPage } from '@/renderer/components/workbench-shell/route-layout';

export const Route = createFileRoute('/_workbench/_shell/dashboard')({
	component: DashboardRoute,
	staticData: {
		workbenchView: 'dashboard',
	},
});

/** Dashboard workbench view (placeholder for the future kanban board). */
function DashboardRoute() {
	return <WorkbenchPlaceholderPage view='dashboard' />;
}
