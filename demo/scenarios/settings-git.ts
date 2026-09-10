import { DEFAULT_APP_SETTINGS } from '@/shared/config';

import { defineScenario } from '../scenario.ts';
import settingsGeneral from './settings-general.ts';

/** Settings → Git with a custom branch prefix and lifecycle automation enabled. */
export default defineScenario({
	...settingsGeneral,
	appSettings: {
		git: {
			...DEFAULT_APP_SETTINGS.git,
			archiveAfterMerge: true,
			branchPrefixCustom: 'philipp',
			branchPrefixSource: 'custom',
			coAuthorEnsemblr: true,
			renameWorkspaceOnBranch: true,
			setUpstreamOnPush: true,
		},
	},
	chat: {
		...settingsGeneral.chat,
		agentSessionId: 'demo-session-settings-git',
		branchId: 'demo-branch-settings-git',
	},
	id: 'settings-git',
	interactions: [],
	label: 'Settings — git',
	route: '/settings/git',
});
