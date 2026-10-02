import {
	DEMO_ENV_FILES,
	DEMO_ENVIRONMENT_VARIABLES,
} from '../fixtures/environment.ts';
import { DEMO_REPOSITORY_SETTINGS } from '../fixtures/settings.ts';
import { defineScenario } from '../scenario.ts';
import settingsGeneral from './settings-general.ts';

/** Repository Settings → Environment with a masked deploy credential and env files. */
export default defineScenario({
	...settingsGeneral,
	chat: {
		...settingsGeneral.chat,
		agentSessionId: 'demo-session-repo-settings-environment',
		branchId: 'demo-branch-repo-settings-environment',
	},
	environment: DEMO_ENVIRONMENT_VARIABLES,
	envFiles: DEMO_ENV_FILES,
	id: 'repo-settings-environment',
	interactions: [],
	label: 'Repository settings — environment',
	repositorySettings: DEMO_REPOSITORY_SETTINGS,
	route: '/settings/repo/repo-ensemblr/environment',
});
