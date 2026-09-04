import {
	DEMO_LINEAR_ISSUES,
	DEMO_LINEAR_METADATA,
} from '../fixtures/linear.ts';
import {
	DEMO_BOARD_STATUSES,
	DEMO_CLOCK,
	DEMO_GIT_FILES,
	DEMO_REPOSITORIES,
} from '../fixtures/workspaces.ts';
import { defineScenario } from '../scenario.ts';
import { assistantText, buildTranscript, userPrompt } from '../transcript.ts';

const BRANCH_ID = 'demo-branch-board';

/**
 * The dashboard board with cards across every column and Linear issues filling
 * Backlog. The one screen people see before they read anything.
 */
export default defineScenario({
	boardStatusByWorkspaceId: DEMO_BOARD_STATUSES,
	chat: {
		agentSessionId: 'demo-session-board',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Release notes in the updates panel',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt('Where is everything?'),
			assistantText('Two in review, two in progress, one done.'),
		]),
	},
	clock: DEMO_CLOCK,
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'board',
	label: 'Board — every column',
	linear: {
		issues: DEMO_LINEAR_ISSUES,
		metadata: DEMO_LINEAR_METADATA,
		organizationName: 'Northwind',
	},
	repositories: DEMO_REPOSITORIES,
	route: '/dashboard',
	workspaceId: 'ws-release-notes',
});
