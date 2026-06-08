import { createFileRoute } from '@tanstack/react-router';

import { SettingsPlaceholder } from '@/renderer/components/settings/settings-placeholder';

export const Route = createFileRoute('/_workbench/settings/models')({
	component: () => (
		<SettingsPlaceholder
			title='Models'
			hint='Pi model defaults for new chats.'
		/>
	),
});
