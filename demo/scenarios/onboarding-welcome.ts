import { HEALTHY_SETUP_CHECKS } from '../fixtures/setup-checks.ts';
import {
	DEMO_CLOCK,
	DEMO_GIT_FILES,
	DEMO_REPOSITORIES,
} from '../fixtures/workspaces.ts';
import { defineScenario } from '../scenario.ts';
import { assistantText, buildTranscript, userPrompt } from '../transcript.ts';

const BRANCH_ID = 'demo-branch-onboarding-welcome';

/**
 * The first-run wizard's welcome screen: the wordmark, one row each for an agent
 * CLI, the GitHub CLI, and Linear, and the language picker beneath them.
 *
 * `/onboarding` renders outside the workbench shell and loads none of its data,
 * so this screen needs no fixture of its own — the checks ride along only so
 * that stepping forward from here lands on a wizard with results in it rather
 * than on skeleton cards.
 */
export default defineScenario({
	chat: {
		agentSessionId: 'demo-session-onboarding-welcome',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Release notes in the updates panel',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt('What does first run ask for?'),
			assistantText('An agent CLI, the GitHub CLI, and optionally Linear.'),
		]),
	},
	clock: DEMO_CLOCK,
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'onboarding-welcome',
	label: 'Onboarding — welcome',
	repositories: DEMO_REPOSITORIES,
	route: '/onboarding',
	setupChecks: HEALTHY_SETUP_CHECKS,
	workspaceId: 'ws-release-notes',
});
