import {
	DEMO_LINEAR_ISSUE_DETAILS,
	DEMO_LINEAR_ISSUES,
	DEMO_LINEAR_METADATA,
} from '../fixtures/linear.ts';
import { DEMO_CLOCK, DEMO_REPOSITORIES } from '../fixtures/workspaces.ts';
import { defineScenario } from '../scenario.ts';
import { assistantText, buildTranscript, userPrompt } from '../transcript.ts';

const BRANCH_ID = 'demo-branch-linear-detail';

/** Linear issue detail route with description, properties, and discussion. */
export default defineScenario({
	chat: {
		agentSessionId: 'demo-session-linear-detail',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Show release notes in updates',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt('Open ENG-412 with its discussion.'),
			assistantText(
				'The issue detail includes its description and two comments.',
			),
		]),
	},
	clock: DEMO_CLOCK,
	id: 'linear-issue-detail',
	label: 'Linear — issue detail',
	linear: {
		issueDetails: DEMO_LINEAR_ISSUE_DETAILS,
		issues: DEMO_LINEAR_ISSUES,
		metadata: DEMO_LINEAR_METADATA,
		organizationName: 'Northwind',
	},
	repositories: DEMO_REPOSITORIES,
	route: '/linear/issue-eng-412',
	workspaceId: 'ws-release-notes',
});
