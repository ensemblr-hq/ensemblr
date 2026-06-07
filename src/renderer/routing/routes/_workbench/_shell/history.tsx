import { createFileRoute } from '@tanstack/react-router';

import { WorkbenchPlaceholderPage } from '@/renderer/components/workbench-shell/route-layout';

export const Route = createFileRoute('/_workbench/_shell/history')({
	component: HistoryRoute,
	staticData: {
		workbenchView: 'history',
	},
});

/** History workbench view (placeholder pending content). */
function HistoryRoute() {
	return <WorkbenchPlaceholderPage view='history' />;
}
