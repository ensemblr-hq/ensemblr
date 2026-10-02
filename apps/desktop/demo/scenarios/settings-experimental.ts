import { DEMO_MODEL_ROLE_APP_SETTINGS } from '../fixtures/models.ts';
import { defineScenario } from '../scenario.ts';
import settingsGeneral from './settings-general.ts';

/** Settings → Experimental with the architecture and CLI-harness gates enabled. */
export default defineScenario({
	...settingsGeneral,
	appSettings: DEMO_MODEL_ROLE_APP_SETTINGS,
	chat: {
		...settingsGeneral.chat,
		agentSessionId: 'demo-session-settings-experimental',
		branchId: 'demo-branch-settings-experimental',
	},
	id: 'settings-experimental',
	interactions: [],
	label: 'Settings — experimental',
	route: '/settings/experimental',
});
