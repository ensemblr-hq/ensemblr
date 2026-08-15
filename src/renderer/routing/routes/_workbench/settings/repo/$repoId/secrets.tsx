import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { InfisicalLinkPanel } from '@/renderer/components/settings/repo-infisical/infisical-link-panel';
import { SettingsSection } from '@/renderer/components/settings/settings-section';

/** Route for a repository's Secrets settings; renders the Infisical link panel keyed by the `repoId` path param. */
export const Route = createFileRoute(
	'/_workbench/settings/repo/$repoId/secrets',
)({
	component: RepoSecretsSettings,
});

/** Repository-scoped secrets panel that links this repository to an Infisical project. */
function RepoSecretsSettings() {
	const { t } = useTranslation();
	const { repoId } = Route.useParams();

	return (
		<SettingsSection
			description={t(
				'settings:repo.secrets.description',
				'Link this repository to an Infisical project so its secrets resolve into every workspace, terminal, and agent. Values are read at launch and never written into the repository.',
			)}
			title={t('settings:repo.secrets.title', 'Secrets')}
		>
			<InfisicalLinkPanel repoId={repoId} />
		</SettingsSection>
	);
}
