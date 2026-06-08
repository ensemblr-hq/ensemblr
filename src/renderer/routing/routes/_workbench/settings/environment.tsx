import { createFileRoute } from '@tanstack/react-router';

import { SettingsPlaceholder } from '@/renderer/components/settings/settings-placeholder';

export const Route = createFileRoute('/_workbench/settings/environment')({
	component: () => (
		<SettingsPlaceholder
			hint='Environment variables used by Ensemble and passed to Pi sessions.'
			title='Environment'
		/>
	),
});
