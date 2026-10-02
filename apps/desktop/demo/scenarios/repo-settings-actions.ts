import { DEMO_REPOSITORY_SETTINGS } from '../fixtures/settings.ts';
import { defineScenario } from '../scenario.ts';
import settingsGeneral from './settings-general.ts';

/** Repository Settings → Actions with team-shared review and chat instructions. */
export default defineScenario({
	...settingsGeneral,
	chat: {
		...settingsGeneral.chat,
		agentSessionId: 'demo-session-repo-settings-actions',
		branchId: 'demo-branch-repo-settings-actions',
	},
	id: 'repo-settings-actions',
	interactions: [],
	label: 'Repository settings — actions',
	repositorySettings: {
		...DEMO_REPOSITORY_SETTINGS,
		settings: [
			...DEMO_REPOSITORY_SETTINGS.settings,
			{
				candidates: [],
				key: 'actionPreferences.codeReview',
				locked: false,
				source: 'ensemblr-config',
				value:
					'Prioritize runtime boundaries, regressions, and user-visible failures.',
			},
			{
				candidates: [],
				key: 'actionPreferences.general',
				locked: false,
				source: 'ensemblr-config',
				value:
					'Use npm and keep renderer, main, preload, and shared boundaries explicit.',
			},
		],
	},
	route: '/settings/repo/repo-ensemblr/actions',
});
