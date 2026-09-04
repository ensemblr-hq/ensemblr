import {
	DEV_SERVER_OUTPUT,
	SHELL_OUTPUT,
	TEST_RUN_OUTPUT,
} from '../fixtures/terminal-output.ts';
import {
	DEMO_CLOCK,
	DEMO_GIT_FILES,
	DEMO_REPOSITORIES,
} from '../fixtures/workspaces.ts';
import { defineScenario } from '../scenario.ts';
import {
	assistantText,
	buildTranscript,
	toolCall,
	toolResult,
	userPrompt,
} from '../transcript.ts';

const BRANCH_ID = 'demo-branch-dock';

/**
 * The dock with a run script streaming: a dev server in the Run tab, a test run
 * and a shell beside it. xterm renders the scrollback exactly as it renders a
 * live PTY, so the colours and the box drawing are the terminal's own.
 */
export default defineScenario({
	chat: {
		agentSessionId: 'demo-session-dock',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Release notes in the updates panel',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt('Start the dev server and check the panel renders the notes.'),
			toolCall('Bash', 'call-dev', {
				command: 'npm run dev',
				description: 'Start the dev server',
			}),
			toolResult(
				'call-dev',
				'Started in the dock — Local: http://localhost:5173/',
			),
			assistantText(
				'Dev server is up on **5173** and HMR has already picked up both edits. The panel renders the notes section under the version.',
			),
		]),
	},
	clock: DEMO_CLOCK,
	dockTab: 'run',
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'dock-terminal',
	label: 'Dock — run script streaming',
	repositories: DEMO_REPOSITORIES,
	route: '/projects/repo-ensemblr/workspaces/ws-release-notes/chats/demo-chat',
	runScripts: [
		{
			availableIn: ['local'],
			command: 'npm run dev',
			icon: 'play',
			isDefault: true,
			name: 'dev',
		},
		{
			availableIn: ['local'],
			command: 'npm run test',
			icon: 'test-tube',
			isDefault: false,
			name: 'test',
		},
		{
			availableIn: ['local'],
			command: 'npm run check && npm run typecheck',
			icon: 'list-checks',
			isDefault: false,
			name: 'checks',
		},
	],
	terminals: [
		{
			id: 'terminal-run',
			kind: 'run-script',
			output: DEV_SERVER_OUTPUT,
			scriptName: 'dev',
			title: 'dev',
		},
		{
			id: 'terminal-tests',
			kind: 'terminal',
			output: TEST_RUN_OUTPUT,
			title: 'tests',
		},
		{
			id: 'terminal-shell',
			kind: 'terminal',
			output: SHELL_OUTPUT,
			title: 'zsh',
		},
	],
	workspaceId: 'ws-release-notes',
});
