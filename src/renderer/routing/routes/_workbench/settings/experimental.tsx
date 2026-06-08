import { createFileRoute } from '@tanstack/react-router';

import { SettingsPlaceholder } from '@/renderer/components/settings/settings-placeholder';

export const Route = createFileRoute('/_workbench/settings/experimental')({
	component: () => (
		<SettingsPlaceholder
			hint='Behind-the-flag features still being validated.'
			title='Experimental'
		/>
	),
});
