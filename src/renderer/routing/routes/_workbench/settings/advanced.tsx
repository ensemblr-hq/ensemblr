import { createFileRoute } from '@tanstack/react-router';

import { SettingsPlaceholder } from '@/renderer/components/settings/settings-placeholder';

export const Route = createFileRoute('/_workbench/settings/advanced')({
	component: () => (
		<SettingsPlaceholder
			hint='Ensemble root directory, Pi executable path, SSH key, and low-level toggles.'
			title='Advanced'
		/>
	),
});
