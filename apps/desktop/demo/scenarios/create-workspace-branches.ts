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

const BRANCH_ID = 'demo-branch-create-branches';

/**
 * The same dialog on its Branches tab, for the contrast the tab exists to show:
 * a branch an active workspace already holds offers *Open* and *Duplicate
 * branch*, while a free one offers *Use branch*.
 *
 * The picker renders a row's actions only while it is highlighted or hovered,
 * and cmdk re-highlights its first row when the *search* changes rather than
 * when the list does — so switching tabs leaves the highlight on a row that no
 * longer exists and every row bare. The arrow key puts it back on the first row,
 * and `DEMO_REPOSITORY_BRANCHES` leads with a held branch so that first row is
 * the two-button case, against the free rows beneath it.
 */
export default defineScenario({
	chat: {
		agentSessionId: 'demo-session-create-branches',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Release notes in the updates panel',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt('Can two workspaces share one branch?'),
			assistantText('No — git allows one worktree per branch. Duplicate it.'),
		]),
	},
	clock: DEMO_CLOCK,
	dockTab: 'run',
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'create-workspace-branches',
	interactions: [
		{ kind: 'click', selector: '[data-action-scope="project"]' },
		{
			kind: 'click',
			selector: '[data-slot="toggle-group-item"]',
			text: 'Branches',
		},
		{ key: 'ArrowDown', kind: 'press-key', selector: '[cmdk-input]' },
	],
	label: 'Create workspace — branches',
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
