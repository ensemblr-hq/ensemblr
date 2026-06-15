import { createFileRoute } from '@tanstack/react-router';

import { EnvironmentVariablesPanel } from '@/renderer/components/settings/environment-variables-panel';

export const Route = createFileRoute(
	'/_workbench/settings/repo/$repoId/environment',
)({
	component: RepoEnvironmentSettings,
});

function RepoEnvironmentSettings() {
	const { repoId } = Route.useParams();
	return (
		<EnvironmentVariablesPanel
			description='Repository-scoped environment variables. Repository values override user defaults; secrets are stored in the macOS Keychain.'
			scope='repository'
			scopeId={repoId}
			title='Environment'
		/>
	);
}
