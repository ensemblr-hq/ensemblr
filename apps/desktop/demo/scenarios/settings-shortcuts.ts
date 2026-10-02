import {
	DEMO_CLOCK,
	DEMO_GIT_FILES,
	DEMO_REPOSITORIES,
} from '../fixtures/workspaces.ts';
import { defineScenario } from '../scenario.ts';
import { assistantText, buildTranscript, userPrompt } from '../transcript.ts';

const BRANCH_ID = 'demo-branch-shortcuts';

/**
 * Settings → Shortcuts, showing the scope groups and their bindings.
 *
 * The one settings page that needs no fixture at all: `SHORTCUTS` is a
 * compile-time table in `@/shared/keymap` and the page renders straight from it,
 * so the bridge answers nothing beyond the app settings every route reads.
 */
export default defineScenario({
	chat: {
		agentSessionId: 'demo-session-shortcuts',
		branchId: BRANCH_ID,
		isStreaming: false,
		model: 'claude-opus-5',
		title: 'Release notes in the updates panel',
		transcript: buildTranscript(BRANCH_ID, DEMO_CLOCK, [
			userPrompt('What opens the command palette?'),
			assistantText('⌘K — the full list is in Settings → Shortcuts.'),
		]),
	},
	clock: DEMO_CLOCK,
	gitFilesByPath: DEMO_GIT_FILES,
	id: 'settings-shortcuts',
	label: 'Settings — shortcuts',
	repositories: DEMO_REPOSITORIES,
	route: '/settings/shortcuts',
	workspaceId: 'ws-release-notes',
});
