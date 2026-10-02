import {
	DEMO_CLOCK,
	DEMO_GIT_FILES,
	DEMO_REPOSITORIES,
} from '../fixtures/workspaces.ts';
import { defineScenario } from '../scenario.ts';
import { assistantText, buildTranscript, userPrompt } from '../transcript.ts';

const BRANCH_ID = 'demo-branch-settings';

/**
 * Settings → Providers with both runtimes reporting a healthy binary.
 *
 * The readiness answers come from `fixtures/providers.ts`: demo mode probes no
 * machine, so without them this page renders the bridge's no-op as "Ensemblr
 * could not probe the executable" — a broken-looking screen on the one page
 * whose subject is that the runtimes are fine.
 */
export default defineScenario({
	chat: {
		agentSessionId: 'demo-session-settings',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Release notes in the updates panel',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt('Which runtimes are wired up?'),
			assistantText('Both — Pi and Claude Code each resolved on PATH.'),
		]),
	},
	clock: DEMO_CLOCK,
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'settings-providers',
	label: 'Settings — providers',
	repositories: DEMO_REPOSITORIES,
	route: '/settings/providers',
	workspaceId: 'ws-release-notes',
});
