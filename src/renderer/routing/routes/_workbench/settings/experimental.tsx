import { createFileRoute } from '@tanstack/react-router';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import { SettingRow } from '@/renderer/components/settings/setting-row';
import { SettingsSection } from '@/renderer/components/settings/settings-section';
import { Switch } from '@/renderer/components/ui/switch';
import {
	architectureDiagramAtom,
	autoRunAfterSetupAtom,
	developerModeAtom,
	tuiHarnessesAtom,
} from '@/renderer/state/preferences';
import { DEFAULT_APP_SETTINGS } from '@/shared/config';

/** Route for the Experimental settings section; renders the experimental-features panel. */
export const Route = createFileRoute('/_workbench/settings/experimental')({
	component: ExperimentalSettings,
});

/** Factory defaults; a row shows its "modified" accent when its value differs. */
const DEFAULTS = DEFAULT_APP_SETTINGS.experimental;

/** Experimental features panel toggling developer-only controls and setup automation defaults. */
function ExperimentalSettings() {
	const { t } = useTranslation();
	const [developerMode, setDeveloperMode] = useAtom(developerModeAtom);
	const [autoRun, setAutoRun] = useAtom(autoRunAfterSetupAtom);
	const [architectureDiagram, setArchitectureDiagram] = useAtom(
		architectureDiagramAtom,
	);
	const [tuiHarnesses, setTuiHarnesses] = useAtom(tuiHarnessesAtom);

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
				control={
					<Switch
						checked={architectureDiagram}
						onCheckedChange={setArchitectureDiagram}
					/>
				}
				description={t(
					'settings:experimental.architecture-diagram.description',
					'Show the workspace architecture diagram and let agents read and redraw it. New sessions pick this up; the ones already running keep the surface they started with.',
				)}
				label={t(
					'settings:experimental.architecture-diagram.label',
					'Architecture diagram',
				)}
				modified={architectureDiagram !== DEFAULTS.architectureDiagram}
				onReset={() => setArchitectureDiagram(DEFAULTS.architectureDiagram)}
			/>

			<SettingRow
				control={
					<Switch checked={tuiHarnesses} onCheckedChange={setTuiHarnesses} />
				}
				description={t(
					'settings:experimental.tui-harnesses.description',
					'Launch Claude Code, OpenAI Codex, or Mistral Vibe in a terminal tab, and let agents launch one too. Off, a harness terminal already open keeps running until you close it.',
				)}
				label={t(
					'settings:experimental.tui-harnesses.label',
					'Third-party CLI harnesses',
				)}
				modified={tuiHarnesses !== DEFAULTS.tuiHarnesses}
				onReset={() => setTuiHarnesses(DEFAULTS.tuiHarnesses)}
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
