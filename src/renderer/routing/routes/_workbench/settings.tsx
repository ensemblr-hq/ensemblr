import { createFileRoute } from '@tanstack/react-router';

import { SettingsShell } from '@/renderer/components/settings/settings-shell';
import { useRouteProfilerMount } from '@/renderer/lib/instrumentation';

/** Full-screen settings route rendered outside the workbench shell. */
export const Route = createFileRoute('/_workbench/settings')({
	component: SettingsRoute,
	staticData: {
		workbenchView: 'settings',
	},
});

/** Full-screen settings layout route rendered outside the workbench shell. */
function SettingsRoute() {
	useRouteProfilerMount('SettingsRoute');
	return <SettingsShell />;
}
