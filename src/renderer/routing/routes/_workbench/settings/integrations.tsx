import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { DictationSection } from '@/renderer/components/settings/dictation/dictation-section';
import { LinearConnectionRow } from '@/renderer/components/settings/integrations/linear-connection-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';

/** Route for the Integrations settings section; renders the integrations panel. */
export const Route = createFileRoute('/_workbench/settings/integrations')({
	component: IntegrationsSettings,
});

/** Integrations settings panel: the Linear connection and voice dictation. */
function IntegrationsSettings() {
	const { t } = useTranslation();

	return (
		<>
			<SettingsSection
				description={t(
					'settings:integrations.description',
					'Third-party services Ensemblr can sign in to on your behalf. Each one is optional and can be disconnected at any time.',
				)}
				title={t('settings:integrations.title', 'Integrations')}
			>
				<LinearConnectionRow />
			</SettingsSection>
			<DictationSection />
		</>
	);
}
