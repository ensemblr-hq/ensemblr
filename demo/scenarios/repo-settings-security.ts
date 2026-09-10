import { DEMO_REPOSITORY_SETTINGS } from '../fixtures/settings.ts';
import { defineScenario } from '../scenario.ts';
import settingsGeneral from './settings-general.ts';

/** Repository Settings → Security with an approval-required permission floor. */
export default defineScenario({
	...settingsGeneral,
	chat: {
		...settingsGeneral.chat,
		agentSessionId: 'demo-session-repo-settings-security',
		branchId: 'demo-branch-repo-settings-security',
	},
	id: 'repo-settings-security',
	interactions: [],
	label: 'Repository settings — security',
	repositorySettings: {
		...DEMO_REPOSITORY_SETTINGS,
		settings: [
			...DEMO_REPOSITORY_SETTINGS.settings,
			{
				candidates: [],
				key: 'security.permissionMode',
				locked: true,
				source: 'ensemblr-config',
				value: 'approval-required',
			},
		],
	},
	route: '/settings/repo/repo-ensemblr/security',
});
