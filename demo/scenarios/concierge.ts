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
import {
	asConciergeTranscript,
	assistantText,
	buildTranscript,
	reasoning,
	toolCall,
	toolResult,
	userPrompt,
} from '../transcript.ts';

const BRANCH_ID = 'demo-branch-concierge';
const CONCIERGE_SESSION_ID = 'demo-concierge';

/**
 * The Concierge: the app-level assistant that answers across workspaces rather
 * than inside one, so its transcript reaches for the board and the issue tracker
 * instead of the working tree.
 */
export default defineScenario({
	boardStatusByWorkspaceId: DEMO_BOARD_STATUSES,
	chat: {
		agentSessionId: 'demo-session-concierge',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Release notes in the updates panel',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt('Carry on with the release notes.'),
			assistantText('Picking it back up.'),
		]),
	},
	clock: DEMO_CLOCK,
	concierge: {
		title: 'Where things stand',
		transcript: asConciergeTranscript(
			CONCIERGE_SESSION_ID,
			buildTranscript(CONCIERGE_SESSION_ID, DEMO_CLOCK, [
				userPrompt(
					'What is waiting on me across everything, and what can I close out today?',
				),
				reasoning(
					'Two questions here, and they read different sources: what is waiting on me is the board plus the review state of each open PR, while what can be closed today is a judgement about how much is left in each one.',
				),
				toolCall('list_workspaces', 'call-workspaces', { status: 'all' }),
				toolResult(
					'call-workspaces',
					'5 workspaces — 2 in review, 2 in progress, 1 done',
				),
				toolCall('linear_list_issues', 'call-issues', { assignee: 'me' }),
				toolResult('call-issues', 'ENG-412 (In Progress), ENG-408 (In Review)'),
				assistantText(
					'Two things are actually waiting on you, and one of them is nearly finished.\n\n**Waiting on you now**\n\n1. **Release notes in updates panel** — PR #438 is open and CI has one job left. Mara asked whether a long changelog should collapse; that is the only unanswered question on it.\n2. **Rate limit headers** — checks are failing on `atlas-api#91`. Nobody has looked at it since yesterday.\n\n**Closeable today**\n\n`Linux tray icon` is done and merged — the workspace is still on the board and can be archived.\n\nThe two in progress, `Composer attachment chips` and `Webhook retry backoff`, have no open questions and nothing blocking them.',
				),
			]),
		),
	},
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'concierge',
	label: 'Concierge — across workspaces',
	linear: {
		issues: DEMO_LINEAR_ISSUES,
		metadata: DEMO_LINEAR_METADATA,
		organizationName: 'Northwind',
	},
	repositories: DEMO_REPOSITORIES,
	route: '/dashboard',
	workspaceId: 'ws-release-notes',
});
