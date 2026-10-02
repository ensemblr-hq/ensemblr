import { DEFAULT_APP_SETTINGS } from '@/shared/config';

import { defineScenario } from '../scenario.ts';
import settingsGeneral from './settings-general.ts';

/** Settings → Appearance with customized typography, colors, and terminal presentation. */
export default defineScenario({
	...settingsGeneral,
	appSettings: {
		appearance: {
			...DEFAULT_APP_SETTINGS.appearance,
			accessibleColors: 'deuteranopia',
			codeTheme: 'github-dark',
			markdownStyle: 'compact',
			terminalFontSize: 14,
			theme: 'dark',
		},
	},
	chat: {
		...settingsGeneral.chat,
		agentSessionId: 'demo-session-settings-appearance',
		branchId: 'demo-branch-settings-appearance',
	},
	id: 'settings-appearance',
	interactions: [],
	label: 'Settings — appearance',
	route: '/settings/appearance',
});
