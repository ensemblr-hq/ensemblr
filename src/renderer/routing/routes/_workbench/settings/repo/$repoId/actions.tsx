import { createFileRoute } from '@tanstack/react-router';

import { SettingsPlaceholder } from '@/renderer/components/settings/settings-placeholder';

export const Route = createFileRoute(
	'/_workbench/settings/repo/$repoId/actions',
)({
	component: () => (
		<SettingsPlaceholder
			hint='Per-action preferences for review, PR, fix-errors, and conflict resolution.'
			title='Actions'
		/>
	),
});
