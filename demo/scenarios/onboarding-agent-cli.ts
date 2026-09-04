import {
	PI_RUNTIME_MISSING,
	setupChecksWith,
} from '../fixtures/setup-checks.ts';
import {
	DEMO_CLOCK,
	DEMO_GIT_FILES,
	DEMO_REPOSITORIES,
} from '../fixtures/workspaces.ts';
import { defineScenario } from '../scenario.ts';
import { assistantText, buildTranscript, userPrompt } from '../transcript.ts';

const BRANCH_ID = 'demo-branch-onboarding-agent-cli';

/**
 * The wizard's agent-CLI step with one runtime satisfied and the other not — Pi
 * "Not installed", Claude Code "Ready", and the step itself green on that one.
 * The either-or gate is the most misunderstood screen in the app, and a shot of
 * it with both runtimes healthy would sell the opposite.
 *
 * Pi's whole check group is staged as missing rather than its executable alone,
 * because the wizard rolls the group into one card: a binary that was never
 * found but whose RPC handshake reported ready is a state no machine can be in.
 *
 * The step is component state — `OnboardingWizard` holds `screenId` in a
 * `useState` seeded to `welcome`, and nothing in the route reaches it — so the
 * scenario walks forward from the welcome screen the way a user does.
 */
export default defineScenario({
	chat: {
		agentSessionId: 'demo-session-onboarding-agent-cli',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Release notes in the updates panel',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt('Do I need both agent runtimes?'),
			assistantText(
				'No — either one clears the step. This machine has Claude.',
			),
		]),
	},
	clock: DEMO_CLOCK,
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'onboarding-agent-cli',
	interactions: [{ kind: 'click', selector: 'button', text: 'Get started' }],
	label: 'Onboarding — agent CLI',
	repositories: DEMO_REPOSITORIES,
	route: '/onboarding',
	setupChecks: setupChecksWith(...PI_RUNTIME_MISSING),
	workspaceId: 'ws-release-notes',
});
