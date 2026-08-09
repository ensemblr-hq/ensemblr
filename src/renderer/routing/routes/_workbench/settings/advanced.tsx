import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { PiExecutableRow } from '@/renderer/components/settings/advanced/pi-executable-row';
import { RootDirectoryRow } from '@/renderer/components/settings/advanced/root-directory-row';
import { TerminalScrollbackRow } from '@/renderer/components/settings/advanced/terminal-scrollback-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';

/** Route for the Advanced settings section; renders the advanced-settings panel. */
export const Route = createFileRoute('/_workbench/settings/advanced')({
	component: AdvancedSettings,
});

/** Advanced settings panel for the Ensemblr root directory, a custom Pi executable override, and the terminal scrollback limit. */
function AdvancedSettings() {
	const { t } = useTranslation();

	return (
		<SettingsSection
			description={t(
				'settings:advanced.description',
				'Root directory, Pi executable override, and terminal-scrollback limits.',
			)}
			title={t('settings:advanced.title', 'Advanced')}
		>
			<RootDirectoryRow />
			<PiExecutableRow />
			<TerminalScrollbackRow />
		</SettingsSection>
	);
}
