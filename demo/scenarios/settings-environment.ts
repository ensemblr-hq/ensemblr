import {
	DEMO_ENV_FILES,
	DEMO_ENVIRONMENT_VARIABLES,
} from '../fixtures/environment.ts';
import { defineScenario } from '../scenario.ts';
import settingsGeneral from './settings-general.ts';

/** Settings → Environment with masked app and repository credentials plus env files. */
export default defineScenario({
	...settingsGeneral,
	chat: {
		...settingsGeneral.chat,
		agentSessionId: 'demo-session-settings-environment',
		branchId: 'demo-branch-settings-environment',
	},
	environment: DEMO_ENVIRONMENT_VARIABLES,
	envFiles: DEMO_ENV_FILES,
	id: 'settings-environment',
	interactions: [],
	label: 'Settings — environment',
	route: '/settings/environment',
});
