import { createFileRoute } from '@tanstack/react-router';

import { SettingsPlaceholder } from '@/renderer/components/settings/settings-placeholder';

export const Route = createFileRoute(
	'/_workbench/settings/repo/$repoId/environment',
)({
	component: () => (
		<SettingsPlaceholder
			hint='Repository-scoped environment variables. Override or extend user defaults.'
			title='Environment'
		/>
	),
});
