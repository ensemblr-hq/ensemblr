import {
	DEMO_CLOCK,
	DEMO_GIT_FILES,
	DEMO_REPOSITORIES,
	DEMO_WORKSPACE_FILES,
} from '../fixtures/workspaces.ts';
import { defineScenario } from '../scenario.ts';
import { assistantText, buildTranscript, userPrompt } from '../transcript.ts';

const BRANCH_ID = 'demo-branch-workspace-files';

/** Files review tab showing ignored dotenv and symlink metadata. */
export default defineScenario({
	chat: {
		agentSessionId: 'demo-session-workspace-files',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Inspect workspace files',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt('Show the complete workspace tree, including ignored files.'),
			assistantText(
				'The Files panel includes the ignored dotenv file and linked context file.',
			),
		]),
	},
	clock: DEMO_CLOCK,
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'workspace-files',
	label: 'Workspace — files',
	repositories: DEMO_REPOSITORIES,
	reviewTab: 'files',
	route: '/projects/repo-ensemblr/workspaces/ws-release-notes/chats/demo-chat',
	workspaceFiles: DEMO_WORKSPACE_FILES,
	workspaceId: 'ws-release-notes',
});
