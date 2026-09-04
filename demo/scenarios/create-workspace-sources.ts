import { DEMO_RUN_SCRIPTS, DEMO_TERMINALS } from '../fixtures/dock.ts';
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

const BRANCH_ID = 'demo-branch-create-source';

/**
 * The create-workspace dialog on its default tab: all three source kinds in the
 * toggle group, the repository picker beside them, and the open pull requests
 * beneath a search field.
 *
 * The dialog is component state on the sidebar, so the scenario clicks the
 * repository header's own create-from-source button. That button is
 * `hidden group-hover:flex`, which costs nothing here — a display:none element
 * is still in the DOM and still fires its handler.
 *
 * The Issues tab merges GitHub issues with the Linear list, so the scenario
 * carries `linear` even though the shot opens on pull requests: without it the
 * third tab is the one that reads as broken.
 */
export default defineScenario({
	chat: {
		agentSessionId: 'demo-session-create-source',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Release notes in the updates panel',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt('How do I start work on an open PR?'),
			assistantText('Create a workspace from it — the dialog lists them.'),
		]),
	},
	clock: DEMO_CLOCK,
	dockTab: 'run',
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'create-workspace-sources',
	interactions: [{ kind: 'click', selector: '[data-action-scope="project"]' }],
	label: 'Create workspace — sources',
	linear: {
		issues: DEMO_LINEAR_ISSUES,
		metadata: DEMO_LINEAR_METADATA,
		organizationName: 'Northwind',
	},
	repositories: DEMO_REPOSITORIES,
	route: '/projects/repo-ensemblr/workspaces/ws-release-notes/chats/demo-chat',
	runScripts: DEMO_RUN_SCRIPTS,
	terminals: DEMO_TERMINALS,
	workspaceId: 'ws-release-notes',
});
