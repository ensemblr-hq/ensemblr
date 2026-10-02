import { DEMO_RUN_SCRIPTS, DEMO_TERMINALS } from '../fixtures/dock.ts';
import {
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

const BRANCH_ID = 'demo-branch-release-notes';
const CONCIERGE_SESSION_ID = 'demo-concierge-delegation';
const CONCIERGE_BRANCH_ID = 'demo-branch-concierge-delegation';

const BRIEF = `The header checks on this branch have been failing since yesterday. Start from the retry middleware the last turn rewrote, get all five header tests green, and report what the middleware was actually getting wrong.`;

/**
 * The Concierge putting an agent to work in a workspace that is not the one on
 * screen. It reads across everything and writes in one place, so the turn that
 * moves real work is a brief handed to an orchestrator rather than an edit —
 * which is the claim the panel-over-the-board shot cannot make on its own.
 *
 * Held mid-turn deliberately: a finished turn folds its tool cards into one
 * summary row, and the cards are the subject here.
 */
export default defineScenario({
	chat: {
		agentSessionId: 'demo-session-release-notes',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Release notes in the updates panel',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt(
				'The updates panel shows a version and a link but never the release notes. Wire the notes through from the feed.',
			),
			reasoning(
				'The feed response already carries a `body` for each release — `resolveUpdate` reads `version` and `htmlUrl` off the candidate and drops everything else. So this is a matter of widening the snapshot the resolver returns, not of fetching anything new.',
			),
			toolCall('Read', 'call-read-update-service', {
				file_path: 'src/main/updates/update-service.ts',
				limit: 40,
				offset: 12,
			}),
			toolResult(
				'call-read-update-service',
				'  return {\n    ...idleStatus(channel),\n    availableVersion: candidate.version,\n    releaseUrl: candidate.htmlUrl,\n    state: "available",\n  };',
			),
			toolCall('Edit', 'call-edit-update-service', {
				file_path: 'src/main/updates/update-service.ts',
				new_string: '    notes: candidate.body ?? null,',
				old_string: '    availableVersion: candidate.version,',
			}),
			toolResult('call-edit-update-service', 'Applied 1 edit.'),
			assistantText(
				'One line at the resolver. `resolveUpdate` built the snapshot from three fields off the candidate release and never read `body`, so the notes were dropped there rather than in the panel.\n\nThree things follow from this:\n\n1. **The feed already carried it.** `body` is on every release the GitHub releases API returns, so nothing new is fetched and the check costs exactly what it did before.\n2. **A release with no notes stays null**, which is the state the panel already renders as an empty section rather than a blank card.\n3. **`UpdateStatusSnapshot` needed no change** — it already declares `notes: string | null`, so the contract is unchanged and the panel renders it without a further edit.\n\n`tests/main/update-service.test.ts` gained one case for the candidate whose body is absent, pinning the null path.',
			),
		]),
	},
	clock: DEMO_CLOCK,
	concierge: {
		title: 'Rate limit headers',
		transcript: asConciergeTranscript(
			CONCIERGE_SESSION_ID,
			buildTranscript(CONCIERGE_BRANCH_ID, DEMO_CLOCK, [
				userPrompt('Anything red across the two repositories?'),
				toolCall('ensemblr_list_workspaces', 'call-list-workspaces', {}),
				toolResult(
					'call-list-workspaces',
					'11 workspaces across ensemblr and atlas-api — 2 in review, 4 in progress.',
				),
				assistantText(
					'One. **Rate limit headers** on `atlas-api` has had failing checks since yesterday afternoon, and nothing has run in that workspace since.\n\nEverything else in review is green and waiting on a human.',
				),
				userPrompt(
					'Rate limit headers has been red since yesterday and nobody has picked it up. Get it moving.',
				),
				reasoning(
					'I cannot touch that worktree — every write outside my own folder is refused — so the useful thing I can do is brief whoever can.\n\nReading what the last agent left there first. A brief that repeats work already done costs more than no brief at all.',
				),
				toolCall('ensemblr_read_conversation', 'call-read-conversation', {
					agentSessionId: 'atlas-api / rate-limit-headers',
					stat: true,
				}),
				toolResult(
					'call-read-conversation',
					'14 turns, 41 tool calls. The last one rewrote the retry middleware and left 3 of 5 header tests failing.',
				),
				toolCall('ensemblr_get_workspace_diff', 'call-workspace-diff', {
					stat: true,
					workspaceId: 'ws-rate-limit',
				}),
				toolResult(
					'call-workspace-diff',
					'4 files changed, +88 −12 — headers.ts, retry-middleware.ts, and the two test files under tests/rate-limit/.',
				),
				toolCall('ensemblr_start_conversation', 'call-start-conversation', {
					prompt: BRIEF,
					title: 'Rate limit headers — get the checks green',
					workspaceId: 'ws-rate-limit',
				}),
			]),
		),
	},
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'concierge-delegation',
	label: 'Concierge — briefing an orchestrator',
	repositories: DEMO_REPOSITORIES,
	route: '/projects/repo-ensemblr/workspaces/ws-release-notes/chats/demo-chat',
	runScripts: DEMO_RUN_SCRIPTS,
	terminals: DEMO_TERMINALS,
	workspaceId: 'ws-release-notes',
});
