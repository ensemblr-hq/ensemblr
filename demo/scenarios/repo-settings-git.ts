import { DEMO_REPOSITORY_SETTINGS } from '../fixtures/settings.ts';
import { defineScenario } from '../scenario.ts';
import settingsGeneral from './settings-general.ts';

/** Repository Settings → Git with a committed base branch and personal cleanup override. */
export default defineScenario({
	...settingsGeneral,
	chat: {
		...settingsGeneral.chat,
		agentSessionId: 'demo-session-repo-settings-git',
		branchId: 'demo-branch-repo-settings-git',
	},
	id: 'repo-settings-git',
	interactions: [],
	label: 'Repository settings — git',
	repositorySettings: {
		...DEMO_REPOSITORY_SETTINGS,
		settings: [
			...DEMO_REPOSITORY_SETTINGS.settings,
			{
				candidates: [],
				key: 'branchFrom',
				locked: false,
				source: 'ensemblr-config',
				value: 'origin/main',
			},
			{
				candidates: [],
				key: 'deleteLocalBranchOnArchive',
				locked: false,
				source: 'sqlite',
				value: true,
			},
		],
	},
	route: '/settings/repo/repo-ensemblr/git',
});
