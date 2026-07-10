import { createFileRoute } from '@tanstack/react-router';

import { EnvironmentVariablesPanel } from '@/renderer/components/settings/environment-variables-panel';

/** Route for the app-level Environment settings section; renders the environment-variables panel. */
export const Route = createFileRoute('/_workbench/settings/environment')({
	component: EnvironmentSettings,
});

/** App-scoped environment settings panel for variables passed to Pi sessions, scripts, and terminals. */
function EnvironmentSettings() {
	return (
		<EnvironmentVariablesPanel
			description='Environment variables used by Ensemblr and passed to Pi sessions, scripts, and terminals.'
			enableEnvFiles
			scope='app'
			title='Environment'
		/>
	);
}
