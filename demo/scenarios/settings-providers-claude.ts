import {
	DEMO_CLOCK,
	DEMO_GIT_FILES,
	DEMO_REPOSITORIES,
} from '../fixtures/workspaces.ts';
import { defineScenario } from '../scenario.ts';
import { assistantText, buildTranscript, userPrompt } from '../transcript.ts';

const BRANCH_ID = 'demo-branch-providers-claude';

/**
 * Settings → Providers on the Claude Code tab, for the account block the Pi tab
 * has no equivalent of: the signed-in address, the organization, and the plan,
 * above the runtime's own readiness checks.
 *
 * The tab is not addressable. `AgentProvidersSection` seeds its active tab from
 * `listAgentProviderDescriptors()[0]`, which is always Pi, and holds it in
 * component state that no route or search param reaches — so the scenario clicks
 * the tab. Both tabs answer from `fixtures/providers.ts`, which is what keeps
 * this shot and `settings-providers` reporting the same two runtimes.
 */
export default defineScenario({
	chat: {
		agentSessionId: 'demo-session-providers-claude',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Release notes in the updates panel',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt('Which account is Claude Code signed in with?'),
			assistantText('The one Settings → Providers reports on its Claude tab.'),
		]),
	},
	clock: DEMO_CLOCK,
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'settings-providers-claude',
	interactions: [
		{ kind: 'click', selector: '[role="tab"]', text: 'Claude Code' },
	],
	label: 'Settings — providers, Claude Code',
	repositories: DEMO_REPOSITORIES,
	route: '/settings/providers',
	workspaceId: 'ws-release-notes',
});
