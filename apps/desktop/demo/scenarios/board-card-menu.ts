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

const BRANCH_ID = 'demo-branch-board-menu';

/**
 * The board with one card's action menu open — the shot `board` cannot stand in
 * for, because the menu is the whole point of it.
 *
 * A card's menu is a *context* menu, not a dropdown: right-click, or nothing.
 * Radix anchors it to the coordinates the event carries, so the gesture sends
 * `contextmenu` from the card's own centre rather than the default `0,0` that
 * would open it against the window corner.
 */
export default defineScenario({
	boardStatusByWorkspaceId: DEMO_BOARD_STATUSES,
	chat: {
		agentSessionId: 'demo-session-board-menu',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Release notes in the updates panel',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt('How do I archive a workspace I am done with?'),
			assistantText('Right-click its card on the board.'),
		]),
	},
	clock: DEMO_CLOCK,
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'board-card-menu',
	interactions: [
		{
			kind: 'context-menu',
			selector: '[data-slot="card"]',
			text: 'Composer attachment chips',
		},
	],
	label: 'Board — card menu open',
	linear: {
		issues: DEMO_LINEAR_ISSUES,
		metadata: DEMO_LINEAR_METADATA,
		organizationName: 'Northwind',
	},
	repositories: DEMO_REPOSITORIES,
	route: '/dashboard',
	workspaceId: 'ws-release-notes',
});
