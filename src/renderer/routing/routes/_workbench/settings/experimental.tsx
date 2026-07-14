import { createFileRoute } from '@tanstack/react-router';
import { useAtom } from 'jotai';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { Switch } from '@/renderer/components/ui/switch';
import {
	autoRunAfterSetupAtom,
	developerModeAtom,
} from '@/renderer/state/preferences';

/** Route for the Experimental settings section; renders the experimental-features panel. */
export const Route = createFileRoute('/_workbench/settings/experimental')({
	component: ExperimentalSettings,
});

/** Experimental features panel toggling developer-only controls and setup automation defaults. */
function ExperimentalSettings() {
	const [developerMode, setDeveloperMode] = useAtom(developerModeAtom);
	const [autoRun, setAutoRun] = useAtom(autoRunAfterSetupAtom);

	return (
		<SettingsSection
			description='Developer-only controls and early automation defaults.'
			title='Experimental'
		>
			<SettingRow
				control={
					<Switch checked={developerMode} onCheckedChange={setDeveloperMode} />
				}
				description='Show developer-only diagnostics and Pi debug controls.'
				label='Developer Mode'
			/>

			<SettingRow
				control={<Switch checked={autoRun} onCheckedChange={setAutoRun} />}
				description="Start a repository's run script automatically after setup when no repository-specific setting overrides it."
				label='Auto-run after setup'
			/>
		</SettingsSection>
	);
}
