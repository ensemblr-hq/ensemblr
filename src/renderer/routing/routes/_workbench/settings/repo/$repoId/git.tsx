import { createFileRoute } from '@tanstack/react-router';

import { SettingsPlaceholder } from '@/renderer/components/settings/settings-placeholder';

export const Route = createFileRoute('/_workbench/settings/repo/$repoId/git')({
	component: () => (
		<SettingsPlaceholder
			hint='Per-repository git defaults: base branch, remote, archive behavior.'
			title='Git'
		/>
	),
});
