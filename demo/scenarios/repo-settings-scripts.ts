import { DEMO_RUN_SCRIPTS } from '../fixtures/dock.ts';
import { DEMO_REPOSITORY_SETTINGS } from '../fixtures/settings.ts';
import { defineScenario } from '../scenario.ts';
import settingsGeneral from './settings-general.ts';

/** Repository Settings → Scripts with setup, named run, archive, and run-mode values. */
export default defineScenario({
	...settingsGeneral,
	chat: {
		...settingsGeneral.chat,
		agentSessionId: 'demo-session-repo-settings-scripts',
		branchId: 'demo-branch-repo-settings-scripts',
	},
	id: 'repo-settings-scripts',
	interactions: [],
	label: 'Repository settings — scripts',
	repositorySettings: {
		...DEMO_REPOSITORY_SETTINGS,
		settings: [
			...DEMO_REPOSITORY_SETTINGS.settings,
			{
				candidates: [],
				key: 'scripts.archive',
				locked: false,
				source: 'ensemblr-config',
				value: 'npm run clean',
			},
			{
				candidates: [],
				key: 'runScriptMode',
				locked: false,
				source: 'ensemblr-config',
				value: 'concurrent',
			},
			{
				candidates: [],
				key: 'autoRunAfterSetup',
				locked: false,
				source: 'ensemblr-config',
				value: true,
			},
		],
	},
	route: '/settings/repo/repo-ensemblr/scripts',
	runScripts: DEMO_RUN_SCRIPTS,
});
