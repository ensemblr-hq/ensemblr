import { DEMO_RUN_SCRIPTS, DEMO_TERMINALS } from '../fixtures/dock.ts';
import {
	DEMO_CLOCK,
	DEMO_GIT_FILES,
	DEMO_REPOSITORIES,
	DEMO_WORKSPACE_FILES,
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

const BRANCH_ID = 'demo-branch-checks';

const PR_BODY = `Reads the release \`body\` the GitHub feed already returns and renders it under the version in Settings → Updates.

- \`resolveUpdate\` carries \`notes\` onto the snapshot it returns.
- The panel renders a **What's new** section when the release has notes, and skips it when it does not.
- \`npm run test:updates\` — 19 passing, including the release-without-notes case.`;

/**
 * The Checks tab over an open pull request: title, description, check runs, and
 * a review comment. The state a workspace is in when it is ready to hand over.
 */
export default defineScenario({
	chat: {
		agentSessionId: 'demo-session-checks',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Release notes in the updates panel',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt('Open the PR when the tests are green.'),
			reasoning(
				'Run the tests first — opening a PR on a red branch just makes CI say the same thing more slowly. If they pass, the branch still needs pushing before `gh pr create` has anything to point at.',
			),
			toolCall('Bash', 'call-checks-tests', {
				command: 'npm run test:updates',
				description: 'Run the update-service tests',
			}),
			toolResult(
				'call-checks-tests',
				'19 pass, 0 fail — including the release-without-notes case.',
			),
			assistantText(
				'Green, including the null-notes case that was the point of the last edit.',
			),
			toolCall('Bash', 'call-checks-push', {
				command: 'git push -u origin release-notes-in-updates-panel',
				description: 'Push the branch',
			}),
			toolResult(
				'call-checks-push',
				"branch 'release-notes-in-updates-panel' set up to track 'origin/release-notes-in-updates-panel'",
			),
			toolCall('Bash', 'call-checks-open-pr', {
				command: 'gh pr create --fill',
				description: 'Open the pull request',
			}),
			toolResult(
				'call-checks-open-pr',
				'https://github.com/ensemblr-hq/ensemblr/pull/438',
			),
			assistantText(
				"Open as **#438**, with the description filled in from the branch rather than left for you to write:\n\n1. **The change is one line at the resolver.** `resolveUpdate` carries `notes` onto the snapshot it already returned, so nothing new is fetched and the contract is unchanged.\n2. **The panel gained a section, not a screen.** It renders a **What's new** block when the release has notes and skips it when it does not — the state it already handled for an empty changelog.\n3. **The null path is pinned.** `tests/main/update-service.test.ts` now covers a candidate whose body is absent, so the case that would have shipped a blank card fails the suite instead.\n\nCI is three of four in: lint, unit and typecheck have passed, and the macOS build is still running. Mara has left one question on the description — whether a 40-line changelog should collapse. It is a real one, but it is about the panel rather than this branch, so it does not have to block the merge.",
			),
		]),
	},
	clock: DEMO_CLOCK,
	dockTab: 'run',
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'checks-pull-request',
	label: 'Checks — open pull request',
	pullRequest: {
		additions: 96,
		baseRefName: 'main',
		body: PR_BODY,
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
			{
				bucket: 'pending',
				id: 'check-build',
				name: 'build (macos-arm64)',
				startedAt: DEMO_CLOCK,
				workflowName: 'CI',
			},
			{
				bucket: 'passing',
				completedAt: DEMO_CLOCK,
				id: 'check-typecheck',
				name: 'typecheck',
				workflowName: 'CI',
			},
		],
		comments: [
			{
				author: 'mara-ellis',
				body: 'Reads well. One thought: should the section collapse when the notes run long? A 40-line changelog will push the update button off screen.',
				createdAt: DEMO_CLOCK,
				id: 'pr-comment-1',
				isResolved: null,
				kind: 'issue-comment',
			},
			{
				author: 'github-actions',
				body: 'Bundle size unchanged (+0.2 kB gzipped).',
				createdAt: DEMO_CLOCK,
				id: 'pr-comment-2',
				isBot: true,
				isResolved: null,
				kind: 'issue-comment',
			},
		],
		deletions: 2,
		deployments: [],
		headRefName: 'release-notes-in-updates-panel',
		headRefOid: '9f3c1ad4e6b28c0517d4a9f2b6e83c71d0a5e4b2',
		isDraft: false,
		mergeable: 'mergeable',
		mergeStateStatus: 'BLOCKED',
		number: 438,
		reviewDecision: 'REVIEW_REQUIRED',
		state: 'open',
		title: 'Show release notes in the updates panel',
		updatedAt: DEMO_CLOCK,
		url: 'https://github.com/ensemblr-hq/ensemblr/pull/438',
	},
	repositories: DEMO_REPOSITORIES,
	runScripts: DEMO_RUN_SCRIPTS,
	reviewTab: 'checks',
	route: '/projects/repo-ensemblr/workspaces/ws-release-notes/chats/demo-chat',
	workspaceFiles: DEMO_WORKSPACE_FILES,
	terminals: DEMO_TERMINALS,
	workspaceId: 'ws-release-notes',
});
