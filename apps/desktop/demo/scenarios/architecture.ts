import { DEMO_ARCHITECTURE_SNAPSHOT } from '../fixtures/architecture.ts';
import { DEMO_MODEL_ROLE_APP_SETTINGS } from '../fixtures/models.ts';
import { DEMO_CLOCK, DEMO_REPOSITORIES } from '../fixtures/workspaces.ts';
import { defineScenario } from '../scenario.ts';
import { assistantText, buildTranscript, userPrompt } from '../transcript.ts';

const BRANCH_ID = 'demo-branch-architecture';

/** Experimental architecture snapshot rendered in its persisted diagram tab. */
export default defineScenario({
	appSettings: DEMO_MODEL_ROLE_APP_SETTINGS,
	architecture: DEMO_ARCHITECTURE_SNAPSHOT,
	chat: {
		agentSessionId: 'demo-session-architecture',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Map the application architecture',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt('Show the workspace architecture.'),
			assistantText(
				'The stored diagram maps renderer, preload, main, storage, and runtimes.',
			),
		]),
	},
	clock: DEMO_CLOCK,
	id: 'architecture',
	openArchitecture: true,
	label: 'Workspace architecture',
	repositories: DEMO_REPOSITORIES,
	route: '/projects/repo-ensemblr/workspaces/ws-release-notes/chats/demo-chat',
	workspaceId: 'ws-release-notes',
});
