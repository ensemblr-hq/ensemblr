import { createFileRoute } from '@tanstack/react-router';

import { SettingsPlaceholder } from '@/renderer/components/settings/settings-placeholder';

export const Route = createFileRoute('/_workbench/settings/integrations')({
	component: () => (
		<SettingsPlaceholder
			hint='Linear, GitHub CLI, enterprise data privacy, and tool approval rules.'
			title='Integrations'
		/>
	),
});
