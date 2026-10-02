import {
	DEMO_CLOCK,
	DEMO_GIT_FILES,
	DEMO_REPOSITORIES,
} from '../fixtures/workspaces.ts';
import { defineScenario } from '../scenario.ts';
import { assistantText, buildTranscript, userPrompt } from '../transcript.ts';

const BRANCH_ID = 'demo-branch-general';

/**
 * Settings → General, for the Ensemblr root directory row at the bottom of it.
 *
 * The row hydrates from the `rootDirectory` bridge call rather than from app
 * settings, so `fixtures/root-directory.ts` answers it — without that the row
 * renders "Not configured" under a Browse button, which is the one thing this
 * shot must not show.
 *
 * It also sits below nine preference rows, off the bottom of a 1496×933 window,
 * so the scenario scrolls to it. Its own Browse button is what the gesture
 * addresses: the row carries no id, and every settings row shares one class.
 */
export default defineScenario({
	chat: {
		agentSessionId: 'demo-session-general',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Release notes in the updates panel',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt('Where does Ensemblr keep its repositories?'),
			assistantText('Under the root directory set in Settings → General.'),
		]),
	},
	clock: DEMO_CLOCK,
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'settings-general',
	interactions: [
		{ kind: 'scroll-into-view', selector: 'button', text: 'Browse' },
	],
	label: 'Settings — general',
	repositories: DEMO_REPOSITORIES,
	route: '/settings/general',
	workspaceId: 'ws-release-notes',
});
