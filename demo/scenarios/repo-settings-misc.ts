import { DEMO_REPOSITORY_SETTINGS } from '../fixtures/settings.ts';
import { defineScenario } from '../scenario.ts';
import settingsGeneral from './settings-general.ts';

/** Repository Settings → Misc with personal preview URLs and workspace-copy patterns. */
export default defineScenario({
	...settingsGeneral,
	chat: {
		...settingsGeneral.chat,
		agentSessionId: 'demo-session-repo-settings-misc',
		branchId: 'demo-branch-repo-settings-misc',
	},
	id: 'repo-settings-misc',
	interactions: [],
	label: 'Repository settings — misc',
	repositorySettings: {
		...DEMO_REPOSITORY_SETTINGS,
		settings: [
			...DEMO_REPOSITORY_SETTINGS.settings.filter(
				(setting) => setting.key !== 'filesToCopy',
			),
			{
				candidates: [],
				key: 'filesToCopy',
				locked: false,
				source: 'sqlite',
				value: ['.env.local', 'config/*.json'],
			},
			{
				candidates: [],
				key: 'previewUrls',
				locked: false,
				source: 'sqlite',
				value: [
					{ name: 'Renderer', url: 'http://localhost:5173' },
					{ name: 'Docs', url: 'http://localhost:4173' },
				],
			},
		],
	},
	route: '/settings/repo/repo-ensemblr/misc',
});
