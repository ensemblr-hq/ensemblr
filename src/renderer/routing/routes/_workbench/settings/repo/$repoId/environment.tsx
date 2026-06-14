import { createFileRoute } from '@tanstack/react-router';

import { EnvironmentTable } from '@/renderer/components/settings/environment-table';
import { SettingsSection } from '@/renderer/components/settings/settings-section';

export const Route = createFileRoute(
	'/_workbench/settings/repo/$repoId/environment',
)({
	component: RepoEnvironmentSettings,
});

function RepoEnvironmentSettings() {
	const { repoId } = Route.useParams();
	return (
		<SettingsSection
			description='Repository-scoped environment variables. Repository values override user defaults; secrets are read from the macOS Keychain when available.'
			title='Environment'
		>
			<EnvironmentTable
				emptyHint='Add a variable to make it available in this repository’s sessions and scripts.'
				scope='repository'
				scopeId={repoId}
			/>
		</SettingsSection>
	);
}
