import { DEMO_MODEL_ROLE_APP_SETTINGS } from '../fixtures/models.ts';
import { DEMO_CLOCK, DEMO_REPOSITORIES } from '../fixtures/workspaces.ts';
import { defineScenario } from '../scenario.ts';
import { assistantText, buildTranscript, userPrompt } from '../transcript.ts';

const BRANCH_ID = 'demo-branch-harness-launcher';

/** Experimental coding-agent harness launcher with its installed menu open. */
export default defineScenario({
	appSettings: DEMO_MODEL_ROLE_APP_SETTINGS,
	chat: {
		agentSessionId: 'demo-session-harness-launcher',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Launch a terminal agent',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt('Open another coding agent in the terminal.'),
			assistantText('Choose an installed harness from the launcher.'),
		]),
	},
	clock: DEMO_CLOCK,
	id: 'harness-launcher',
	interactions: [
		{ kind: 'click', selector: 'button', text: 'Launch coding agent' },
	],
	label: 'Harness launcher',
	repositories: DEMO_REPOSITORIES,
	route: '/projects/repo-ensemblr/workspaces/ws-release-notes/chats/demo-chat',
	workspaceId: 'ws-release-notes',
});
