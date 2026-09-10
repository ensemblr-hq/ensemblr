import { DEMO_WORKSPACE_HISTORY } from '../fixtures/history.ts';
import { DEMO_CLOCK, DEMO_REPOSITORIES } from '../fixtures/workspaces.ts';
import { defineScenario } from '../scenario.ts';
import { assistantText, buildTranscript, userPrompt } from '../transcript.ts';

const BRANCH_ID = 'demo-branch-workspace-history';

/** Global history route populated with active and archived workspaces. */
export default defineScenario({
	chat: {
		agentSessionId: 'demo-session-workspace-history',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Workspace history',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt('Show me the workspaces we archived this week.'),
			assistantText(
				'The global History view has the active and archived entries.',
			),
		]),
	},
	clock: DEMO_CLOCK,
	id: 'workspace-history',
	label: 'Workspace history',
	repositories: DEMO_REPOSITORIES,
	route: '/history',
	workspaceHistory: DEMO_WORKSPACE_HISTORY,
	workspaceId: 'ws-release-notes',
});
