import { DEMO_REPOSITORY_SETTINGS } from '../fixtures/settings.ts';
import { defineScenario } from '../scenario.ts';
import settingsGeneral from './settings-general.ts';

/** Repository Settings → Secrets at the Infisical project-link surface. */
export default defineScenario({
	...settingsGeneral,
	chat: {
		...settingsGeneral.chat,
		agentSessionId: 'demo-session-repo-settings-secrets',
		branchId: 'demo-branch-repo-settings-secrets',
	},
	id: 'repo-settings-secrets',
	interactions: [],
	label: 'Repository settings — secrets',
	repositorySettings: DEMO_REPOSITORY_SETTINGS,
	route: '/settings/repo/repo-ensemblr/secrets',
});
