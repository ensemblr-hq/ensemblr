import { DEMO_RUN_SCRIPTS, DEMO_TERMINALS } from '../fixtures/dock.ts';
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

const BRANCH_ID = 'demo-branch-afk-report';

/**
 * The report the run left behind, which is the whole subject of the shot.
 *
 * It carries what the loop asks an unattended run to account for: which path it
 * sized the change onto, what each review round moved, the calls it took on the
 * user's behalf, the finding it argued with rather than accepted, and the pull
 * request. A run that reported only "done" would be the failure this section
 * exists to prevent.
 */
const REPORT = `Secrets work on Linux. **[#443](https://github.com/ensemblr-hq/ensemblr/pull/443)** is open — I have not merged it.

**Path.** Full loop — two files, but a silent failure mode a diff does not show.
Two review rounds.

- **Round 1** moved three things: a swallowed write error, a probe cached for the
  process lifetime, and a new setup check with no \`ru\` or \`el\`.
- **Round 2** came back clean.

### What I decided on your behalf

1. **No keyring daemon degrades rather than refuses.** Overrule this one if you
   disagree — a user who cannot launch the app cannot read the warning explaining
   why. \`keyring-probe.ts\` reports the session in the diagnostics rollup, so it
   is visible before a secret is entered rather than after.
2. **Ciphertext goes in SQLite, not a file.** One store to back up, one to
   migrate, and no second path that can disagree with the first.
3. **No \`libsecret\` binding.** More direct, but it makes a missing package a
   cold start on SteamOS and Silverblue, which ship no daemon.

### The finding I did not take

The reviewer wanted the probe re-run per read. I disagreed and it withdrew:
\`isEncryptionAvailable()\` is a synchronous IPC round trip on eleven call sites,
and a keyring appearing mid-session is rare enough that a relaunch is the honest
fix. It is now cached per launch rather than for the process lifetime, which was
the half of that finding that was right.

### Least sure about

Decision 1. Everything else follows from it, and inverting it is a one-line
change plus its test.`;

/**
 * What an unattended run leaves behind when it finishes: the report, the Review
 * chat it opened over its own change, and an open pull request.
 *
 * The turn is deliberately finished rather than mid-run, which is the opposite
 * call from `afk-mode`. A settled turn folds its whole activity into one summary
 * row and fills the pane with its final message — and here the final message is
 * the subject, because the report is the only account of the run the user gets.
 * The AFK chip stays lit on a finished run, which is what the shot has to show:
 * the mode is a property of the chat, not of the turn.
 *
 * The header pill reads `2 uncommitted changes` under a report saying the branch
 * is pushed, which is the one thing in the frame that does not agree with itself.
 * Dropping this workspace from `gitFilesByPath` was tried and is worse: the pill
 * becomes `3 unpushed commits`, which contradicts an open pull request harder,
 * and the Changes panel becomes a third of the frame spent on an empty state.
 *
 * The two states are not independent, which is why that swap trades down rather
 * than across. `getPullRequestSnapshot` in `handlers.ts` hardcodes
 * `branchSync.ahead: 3` for every scenario declaring a `pullRequest`, and
 * `right-sidebar-header-state.ts` resolves `uncommitted` before `unpushed` — so
 * the changed files were masking the hardcoded value rather than competing with
 * it. The lever is that `ahead`, and moving it restages `checks-pull-request`
 * too, so it wants its own change rather than a ride along in this one.
 */
export default defineScenario({
	chat: {
		afkMode: true,
		agentSessionId: 'demo-session-afk-report',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Secret storage on Linux',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt(
				'Secrets still go to the Keychain, so Linux has nowhere to put them. Make it work over there — I am heading out, so take it all the way.',
			),
			toolCall('ensemblr_start_review', 'call-review', {
				title: 'Secret storage on Linux',
			}),
			toolResult(
				'call-review',
				'Review conversation opened. 4 findings: swallowed write error, probe cached for the process lifetime, missing ru/el on the new check, re-probe per read.',
			),
			toolCall('ensemblr_send_follow_up', 'call-fixes', {
				agentSessionId: 'session-review',
				message:
					'First three are right — fix them. The fourth I disagree with: isEncryptionAvailable is a synchronous IPC round trip on eleven call sites, and a daemon appearing mid-session is rare enough that a relaunch is the honest fix.',
			}),
			toolResult(
				'call-fixes',
				'Fixed the first three. Withdrew the fourth, keeping the per-launch cache rather than the per-process one.',
			),
			toolCall('Bash', 'call-pr', {
				command:
					'gh pr create --title "feat(secrets): store secrets through safeStorage on Linux"',
				description: 'Open the pull request',
			}),
			toolResult('call-pr', 'https://github.com/ensemblr-hq/ensemblr/pull/443'),
			assistantText(REPORT),
		]),
	},
	clock: DEMO_CLOCK,
	dockTab: 'run',
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'afk-mode-report',
	label: 'AFK mode — the run’s report',
	pullRequest: {
		additions: 206,
		baseRefName: 'main',
		body: 'Stores secrets through Electron `safeStorage`, with the ciphertext in SQLite rather than the Keychain.\n\nA session with no keyring daemon takes the obfuscated path and reports itself in the diagnostics rollup, rather than refusing to launch.',
		checks: [
			{
				bucket: 'passing',
				completedAt: DEMO_CLOCK,
				id: 'check-lint',
				name: 'lint',
				workflowName: 'CI',
			},
			{
				bucket: 'passing',
				completedAt: DEMO_CLOCK,
				id: 'check-unit',
				name: 'unit',
				workflowName: 'CI',
			},
		],
		comments: [],
		deletions: 38,
		deployments: [],
		headRefName: 'linux-secret-storage',
		headRefOid: 'c47a1f92be05d3671048ac5e2f9b73d1a608e5c4',
		isDraft: false,
		mergeable: 'mergeable',
		mergeStateStatus: 'BLOCKED',
		number: 443,
		reviewDecision: 'REVIEW_REQUIRED',
		state: 'open',
		title: 'Store secrets through safeStorage on Linux',
		updatedAt: DEMO_CLOCK,
		url: 'https://github.com/ensemblr-hq/ensemblr/pull/443',
	},
	repositories: DEMO_REPOSITORIES,
	route: '/projects/repo-ensemblr/workspaces/ws-secret-storage/chats/demo-chat',
	runScripts: DEMO_RUN_SCRIPTS,
	subAgents: [
		{
			afkMode: true,
			agentSessionId: 'session-review',
			branchId: 'branch-review',
			isStreaming: false,
			model: 'claude-opus-5',
			tabId: 'tab-review',
			title: 'Review — Secret storage on Linux',
			transcript: buildTranscript('branch-review', DEMO_CLOCK, [
				userPrompt('Review the change on this branch.'),
				assistantText(
					'**Four findings, one withdrawn.**\n\n1. **The obfuscated path swallows its own write error.** `storeObfuscated` catches and returns `void`, so a full disk reads as a stored secret. Fixed: it returns the same result type as the encrypted path.\n\n2. **The probe caches for the process lifetime.** A user who starts their keyring after launching is stuck on the degraded path until they quit, with no way to tell. Fixed: cached per launch and re-read when the setup rollup refreshes.\n\n3. **The new setup check ships English only.** `keyring-probe.ts` returns a label rather than a code, which is the boundary rule in reverse. Fixed: it returns `labelMessage: { code }` and the renderer mapper carries `ru` and `el`.\n\n4. ~~Re-probe on every read~~ — **withdrawn.** I asked for it so a daemon started mid-session is picked up; the answer is that `isEncryptionAvailable()` is a synchronous IPC round trip reached from eleven call sites, and the per-launch cache in finding 2 already covers the case that matters. Agreed.',
				),
			]),
		},
	],
	terminals: DEMO_TERMINALS,
	workspaceId: 'ws-secret-storage',
});
