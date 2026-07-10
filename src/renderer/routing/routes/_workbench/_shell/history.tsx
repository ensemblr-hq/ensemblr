import { createFileRoute } from '@tanstack/react-router';

import { HistoryPage } from '@/renderer/components/workbench-shell/history';

/** Registers the `/history` workbench view listing every workspace ever created. */
export const Route = createFileRoute('/_workbench/_shell/history')({
	component: HistoryRoute,
	staticData: {
		workbenchView: 'history',
	},
});

/** History workbench view: all workspaces ever created, grouped by last activity. */
function HistoryRoute() {
	return <HistoryPage />;
}
