import { createFileRoute } from '@tanstack/react-router';

import { SettingsPlaceholder } from '@/renderer/components/settings/settings-placeholder';

export const Route = createFileRoute('/_workbench/settings/git')({
	component: () => (
		<SettingsPlaceholder
			hint='Branch naming, workspace lifecycle, and push behavior defaults.'
			title='Git'
		/>
	),
});
