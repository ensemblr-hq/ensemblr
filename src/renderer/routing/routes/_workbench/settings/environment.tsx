import { createFileRoute } from '@tanstack/react-router';

import { EnvironmentTable } from '@/renderer/components/settings/environment-table';
import { SettingsSection } from '@/renderer/components/settings/settings-section';

export const Route = createFileRoute('/_workbench/settings/environment')({
	component: EnvironmentSettings,
});

function EnvironmentSettings() {
	return (
		<SettingsSection
			description='Environment variables Ensemble forwards to Pi sessions, scripts, and terminals. Values are resolved at session launch; this view is read-only. Manage entries through the macOS Keychain or your shell profile.'
			title='Environment'
		>
			<EnvironmentTable scope='app' />
		</SettingsSection>
	);
}
