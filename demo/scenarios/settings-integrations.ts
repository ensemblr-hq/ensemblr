import { DEFAULT_APP_SETTINGS } from '@/shared/config';

import {
	DEMO_LINEAR_ISSUES,
	DEMO_LINEAR_METADATA,
} from '../fixtures/linear.ts';
import { defineScenario } from '../scenario.ts';
import settingsGeneral from './settings-general.ts';

/** Settings → Integrations with a connected Linear organization and dictation configured. */
export default defineScenario({
	...settingsGeneral,
	appSettings: {
		dictation: {
			...DEFAULT_APP_SETTINGS.dictation,
			enabled: true,
			language: 'en',
		},
	},
	chat: {
		...settingsGeneral.chat,
		agentSessionId: 'demo-session-settings-integrations',
		branchId: 'demo-branch-settings-integrations',
	},
	id: 'settings-integrations',
	interactions: [],
	label: 'Settings — integrations',
	linear: {
		issues: DEMO_LINEAR_ISSUES,
		metadata: DEMO_LINEAR_METADATA,
		organizationName: 'Northwind',
	},
	route: '/settings/integrations',
});
