import { createFileRoute } from '@tanstack/react-router';

import { SettingsPlaceholder } from '@/renderer/components/settings/settings-placeholder';

export const Route = createFileRoute(
	'/_workbench/settings/repo/$repoId/scripts',
)({
	component: () => (
		<SettingsPlaceholder
			hint='Setup, run, and archive scripts for this repository.'
			title='Scripts'
		/>
	),
});
