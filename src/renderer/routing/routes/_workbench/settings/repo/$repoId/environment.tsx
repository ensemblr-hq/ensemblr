import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { EnvironmentVariablesPanel } from '@/renderer/components/settings/environment-variables-panel';

/** Route for a repository's Environment settings; renders the repo-scoped environment-variables panel keyed by the `repoId` path param. */
export const Route = createFileRoute(
	'/_workbench/settings/repo/$repoId/environment',
)({
	component: RepoEnvironmentSettings,
});

/** Repository-scoped environment settings panel whose values override user defaults for this repo. */
function RepoEnvironmentSettings() {
	const { t } = useTranslation();
	const { repoId } = Route.useParams();

	return (
		<EnvironmentVariablesPanel
			description={t(
				'settings:repo.environment.description',
				'Repository-scoped environment variables. Repository values override user defaults; secrets are stored in the macOS Keychain.',
			)}
			enableEnvFiles
			scope='repository'
			scopeId={repoId}
			title={t('settings:repo.environment.title', 'Environment')}
		/>
	);
}
