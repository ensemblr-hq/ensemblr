import { DEMO_UPDATE_AVAILABLE } from '../fixtures/updates.ts';
import { DEMO_CLOCK, DEMO_REPOSITORIES } from '../fixtures/workspaces.ts';
import { defineScenario } from '../scenario.ts';
import { assistantText, buildTranscript, userPrompt } from '../transcript.ts';

const BRANCH_ID = 'demo-branch-update-available';

/** Navigation sidebar showing a newer Ensemblr release. */
export default defineScenario({
	chat: {
		agentSessionId: 'demo-session-update-available',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Review the available update',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt('Is there a newer release?'),
			assistantText('Ensemblr 0.2.0 is available from the release page.'),
		]),
	},
	clock: DEMO_CLOCK,
	id: 'update-available',
	label: 'Update — available',
	repositories: DEMO_REPOSITORIES,
	route: '/projects/repo-ensemblr/workspaces/ws-release-notes/chats/demo-chat',
	updateStatus: DEMO_UPDATE_AVAILABLE,
	workspaceId: 'ws-release-notes',
});
