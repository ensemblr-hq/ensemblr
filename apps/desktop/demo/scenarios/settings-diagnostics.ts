import {
	SHELL_ENVIRONMENT_FALLBACK,
	setupChecksWith,
} from '../fixtures/setup-checks.ts';
import {
	DEMO_CLOCK,
	DEMO_GIT_FILES,
	DEMO_REPOSITORIES,
} from '../fixtures/workspaces.ts';
import { defineScenario } from '../scenario.ts';
import { assistantText, buildTranscript, userPrompt } from '../transcript.ts';

const BRANCH_ID = 'demo-branch-diagnostics';

/**
 * Settings → Diagnostics with the whole setup rollup and exactly one check off
 * `success`.
 *
 * The warning is the shell check rather than the root directory the earlier shot
 * used: the panel groups core before storage, so at the 1496×933 window every
 * shot is taken at, a storage row's remediation buttons fall below the fold and
 * the one thing this image exists to show would be cropped out.
 *
 * Its counts are not authored — `handlers.ts` rolls the declared checks up the
 * way the main process does, so the summary strip and the rows beneath it cannot
 * disagree.
 */
export default defineScenario({
	chat: {
		agentSessionId: 'demo-session-diagnostics',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Release notes in the updates panel',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt('Is anything on this machine still unresolved?'),
			assistantText(
				'One warning: the login shell fell back. Nothing blocking.',
			),
		]),
	},
	clock: DEMO_CLOCK,
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'settings-diagnostics',
	label: 'Settings — diagnostics',
	repositories: DEMO_REPOSITORIES,
	route: '/settings/diagnostics',
	setupChecks: setupChecksWith(SHELL_ENVIRONMENT_FALLBACK),
	workspaceId: 'ws-release-notes',
});
