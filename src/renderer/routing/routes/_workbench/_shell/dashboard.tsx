import { createFileRoute } from '@tanstack/react-router';

import { DashboardBoard } from '@/renderer/components/workbench-shell/dashboard/dashboard-board';

/** Registers the `/dashboard` workbench view (the workspace Kanban board). */
export const Route = createFileRoute('/_workbench/_shell/dashboard')({
	component: DashboardRoute,
	staticData: {
		workbenchView: 'dashboard',
	},
});

/** Dashboard workbench view — the workspace Kanban board. */
function DashboardRoute() {
	return <DashboardBoard />;
}
