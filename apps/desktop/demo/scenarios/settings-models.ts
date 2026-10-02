import { DEMO_MODEL_ROLE_APP_SETTINGS } from '../fixtures/models.ts';
import { defineScenario } from '../scenario.ts';
import settingsGeneral from './settings-general.ts';

/** Settings → Models focused on cross-runtime delegation and current role assignments. */
export default defineScenario({
	...settingsGeneral,
	appSettings: DEMO_MODEL_ROLE_APP_SETTINGS,
	chat: {
		...settingsGeneral.chat,
		agentSessionId: 'demo-session-settings-models',
		branchId: 'demo-branch-settings-models',
	},
	id: 'settings-models',
	interactions: [
		{
			kind: 'scroll-into-view',
			selector: 'div',
			text: 'Builder',
		},
	],
	label: 'Settings — models and roles',
	route: '/settings/models',
});
