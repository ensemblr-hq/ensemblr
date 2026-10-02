import {
	DEMO_LINEAR_ISSUES,
	DEMO_LINEAR_METADATA,
} from '../fixtures/linear.ts';
import {
	DEMO_CLOCK,
	DEMO_GIT_FILES,
	DEMO_REPOSITORIES,
} from '../fixtures/workspaces.ts';
import { defineScenario } from '../scenario.ts';
import { assistantText, buildTranscript, userPrompt } from '../transcript.ts';

const BRANCH_ID = 'demo-branch-linear';

/**
 * The Linear view: a connected account's issues, with their states, labels,
 * assignees and priorities — the surface a workspace is started from.
 */
export default defineScenario({
	chat: {
		agentSessionId: 'demo-session-linear',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Release notes in the updates panel',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt('What is assigned to me this cycle?'),
			assistantText('ENG-412 is yours and in progress.'),
		]),
	},
	clock: DEMO_CLOCK,
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'linear-issues',
	label: 'Linear — issue list',
	linear: {
		issues: DEMO_LINEAR_ISSUES,
		metadata: DEMO_LINEAR_METADATA,
		organizationName: 'Northwind',
	},
	repositories: DEMO_REPOSITORIES,
	route: '/linear',
	workspaceId: 'ws-release-notes',
});
