import { createFileRoute } from '@tanstack/react-router';

import { SettingsPlaceholder } from '@/renderer/components/settings/settings-placeholder';

export const Route = createFileRoute('/_workbench/settings/repo/$repoId/misc')({
	component: () => (
		<SettingsPlaceholder
			hint='Repository paths, preview URL template, files-to-copy patterns, and lifecycle.'
			title='Misc'
		/>
	),
});
