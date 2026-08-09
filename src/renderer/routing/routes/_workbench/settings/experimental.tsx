import { createFileRoute } from '@tanstack/react-router';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { Switch } from '@/renderer/components/ui/switch';
import {
	autoRunAfterSetupAtom,
	developerModeAtom,
} from '@/renderer/state/preferences';
import { DEFAULT_APP_SETTINGS } from '@/shared/config';

/** Route for the Experimental settings section; renders the experimental-features panel. */
export const Route = createFileRoute('/_workbench/settings/experimental')({
	component: ExperimentalSettings,
});

/** Factory defaults; a row shows its "modified" accent when its value differs. */
const DEFAULTS = {
	autoRunAfterSetup: DEFAULT_APP_SETTINGS.experimental.autoRunAfterSetup,
	developerMode: false,
} as const;

/** Experimental features panel toggling developer-only controls and setup automation defaults. */
function ExperimentalSettings() {
	const { t } = useTranslation();
	const [developerMode, setDeveloperMode] = useAtom(developerModeAtom);
	const [autoRun, setAutoRun] = useAtom(autoRunAfterSetupAtom);

	return (
		<SettingsSection
			description={t(
				'settings:experimental.description',
				'Developer-only controls and early automation defaults.',
			)}
			title={t('settings:experimental.title', 'Experimental')}
		>
			<SettingRow
				control={
					<Switch checked={developerMode} onCheckedChange={setDeveloperMode} />
				}
				description={t(
					'settings:experimental.developer-mode.description',
					'Show developer-only diagnostics and Pi debug controls.',
				)}
				label={t(
					'settings:experimental.developer-mode.label',
					'Developer Mode',
				)}
				modified={developerMode !== DEFAULTS.developerMode}
				onReset={() => setDeveloperMode(DEFAULTS.developerMode)}
			/>

			<SettingRow
				control={<Switch checked={autoRun} onCheckedChange={setAutoRun} />}
				description={t(
					'settings:experimental.auto-run.description',
					"Start a repository's run script automatically after setup when no repository-specific setting overrides it.",
				)}
				label={t(
					'settings:experimental.auto-run.label',
					'Auto-run after setup',
				)}
				modified={autoRun !== DEFAULTS.autoRunAfterSetup}
				onReset={() => setAutoRun(DEFAULTS.autoRunAfterSetup)}
			/>
		</SettingsSection>
	);
}
