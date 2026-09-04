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
	reasoning,
	toolCall,
	toolResult,
	userPrompt,
} from '../transcript.ts';

const BRANCH_ID = 'demo-branch-run-picker';

/**
 * The dock's Run tab with the run-script picker open, so the repository's named
 * scripts and their icons are legible.
 *
 * A running script and an open picker cannot share a frame: the dock header
 * swaps the split Run button for Stop while a run session is live, so the picker
 * the shot is about does not exist in that state. The run session here is
 * therefore reported `exited` — its output still in the tab, the picker choosing
 * what to start next — which is the state the shot this replaces was taken in
 * too.
 */
export default defineScenario({
	chat: {
		agentSessionId: 'demo-session-run-picker',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Release notes in the updates panel',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt(
				'The dev server died after the last edit. Restart it and tell me what else I can run from here.',
			),
			reasoning(
				'The run script is a dock session rather than a shell of mine, so I stop and start it through the dock rather than spawning a second `npm run dev` that would fight the first one over 5173.',
			),
			toolCall('Bash', 'call-run-port', {
				command: 'lsof -ti tcp:5173',
				description: 'Check whether 5173 is still held',
			}),
			toolResult('call-run-port', '(no output — the port is free)'),
			assistantText(
				'Port is clear, so the process is genuinely gone rather than orphaned.',
			),
			toolCall('Bash', 'call-run-scripts', {
				command: 'rg "^\\[scripts.run" -A2 .ensemblr/settings.toml',
				description: 'Read the configured run scripts',
			}),
			toolResult(
				'call-run-scripts',
				'[scripts.run.dev]\ncommand = "npm run dev"\ndefault = true\n[scripts.run.checks]\ncommand = "npm run check && npm run typecheck"\n[scripts.run.test]\ncommand = "npx vitest run"\n[scripts.run.playground]\ncommand = "npm run dev:playground"\n[scripts.run.package]\ncommand = "npm run package"',
			),
			assistantText(
				'Restarted **dev** — Vite is back on 5173, and the dock picked the port out of the output on its own, so the header now offers to open it.\n\nThe repository declares five run scripts in `.ensemblr/settings.toml`, and the picker beside the Run button starts any of them:\n\n1. **dev** is flagged `default = true`, which is what ⌘R targets from anywhere in the workspace — the Run button always names it.\n2. **checks** and **test** are the two to reach for before opening a PR: Biome plus `tsc` across all four projects, and Vitest over the renderer and shared suites.\n3. **playground** serves the component sandbox on its own port, so it can run beside **dev** rather than instead of it.\n4. **package** builds the app bundle. It is slow enough that you want it deliberate rather than on a chord, which is why it is in the list and not on the button.\n\nA script can also declare `available_in`, and one that does not name the local environment is left out of this list rather than offered and failed at launch.',
			),
		]),
	},
	clock: DEMO_CLOCK,
	dockTab: 'run',
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'dock-run-picker',
	interactions: [
		{ kind: 'click', selector: '[aria-label="Choose run script"]' },
	],
	label: 'Dock — run script picker',
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
			command: 'npm run check && npm run typecheck',
			icon: 'list-checks',
			isDefault: false,
			name: 'checks',
		},
		{
			availableIn: ['local'],
			command: 'npx vitest run',
			icon: 'test-tube',
			isDefault: false,
			name: 'test',
		},
		{
			availableIn: ['local'],
			command: 'npm run dev:playground',
			icon: 'palette',
			isDefault: false,
			name: 'playground',
		},
		{
			availableIn: ['local'],
			command: 'npm run package',
			icon: 'package',
			isDefault: false,
			name: 'package',
		},
	],
	terminals: [
		{
			id: 'terminal-run',
			kind: 'run-script',
			output: DEV_SERVER_OUTPUT,
			scriptName: 'dev',
			status: 'exited',
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
