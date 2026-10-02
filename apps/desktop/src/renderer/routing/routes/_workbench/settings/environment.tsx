import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { EnvironmentVariablesPanel } from '@/renderer/components/settings/environment-variables-panel';

/** Route for the app-level Environment settings section; renders the environment-variables panel. */
export const Route = createFileRoute('/_workbench/settings/environment')({
	component: EnvironmentSettings,
});

/** App-scoped environment settings panel for variables passed to agent sessions, scripts, and terminals. */
function EnvironmentSettings() {
	const { t } = useTranslation();

	return (
		<EnvironmentVariablesPanel
			description={t(
				'settings:environment.description',
				'Environment variables used by Ensemblr and passed to agent sessions, scripts, and terminals.',
			)}
			enableEnvFiles
			scope='app'
			title={t('settings:environment.title', 'Environment')}
		/>
	);
}
